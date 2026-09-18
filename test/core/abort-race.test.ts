import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { origin } from '../../src/adapter/origin'

// Adversarial proof for the deferred abort-signal provenance channel.
//
// `src/adapter/origin.ts` is a *module-level* slot: the Bun adapter's
// `withOrigin` wrapper writes the request `Bun.serve` handed it, calls
// `app.fetch`, and clears the slot in `finally`. Whoever classifies first
// compares `request === origin.request` — a match defers materializing
// `request.signal` (leaving `context['~sig']` undefined), a mismatch arms
// eagerly (pre-feature semantics). That is `armEager` in
// `src/handler/fetch.ts` on the request-hook lanes, and the compiled route's
// entry probe (`armEntryAbort`) on the lane where `fetch` has no hook to run.
//
// The safety argument is run-to-completion: set → check → clear is one
// synchronous frame, so no second request can ever observe a foreign window.
// The argument is only worth as much as the counter-examples it survives, so
// every scenario below runs real `Bun.serve` traffic and tries to break it.
//
// Probe points, and why they are the honest ones:
//   * A request-lane hook (`.request()`) runs before any codegen-emitted site,
//     and the FIRST route-chain hook (`.derive()`) runs immediately after the
//     route's entry probe and before every other one, so
//     `context['~sig'] === undefined` there means, and only means, "this
//     request was classified as deferred".
//   * Later observation points are NOT classification: an async route's chain
//     guards arm the slot themselves after a suspension
//     (`abortChainGuard` in `src/compile/handler/jit.ts`), which is the
//     feature working, not a
//     provenance hit.

/**
 * Simultaneous in-flight sockets per storm.
 *
 * macOS caps a listener's accept queue at `kern.ipc.somaxconn` (128) and RSTs
 * the overflow instead of dropping the SYN, so firing 200 connections at a
 * fresh `Bun.serve` in one burst yields client-side ECONNRESET ~20% of the
 * time — a transport artifact that says nothing about provenance. A pool that
 * is refilled the instant a slot frees keeps the same request totals and
 * produces *more* overlapping open/close window cycles than a single burst,
 * because the async lanes stay in flight while new windows keep opening.
 */
const IN_FLIGHT = 32

const storm = async <T>(tasks: (() => Promise<T>)[]): Promise<T[]> => {
	const results = new Array<T>(tasks.length)
	let next = 0

	const worker = async () => {
		while (next < tasks.length) {
			const index = next++
			results[index] = await tasks[index]()
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(IN_FLIGHT, tasks.length) }, worker)
	)

	return results
}

const servers: any[] = []

const listen = async (app: any): Promise<number> => {
	app.listen(0)
	servers.push(app)
	// give Bun.serve a tick to bind before the storm
	await Bun.sleep(20)

	return app.server.port as number
}

// always tear down, including on assertion failure
afterEach(() => {
	for (const app of servers.splice(0)) app.server?.stop(true)
})

const idOf = (request: Request) => request.headers.get('x-id') ?? '?'

/** the slot as classification left it: undefined ⇒ deferred, armed ⇒ eager */
const classify = (context: any) =>
	context['~sig'] === undefined ? 'deferred' : 'eager'

const get = (port: number, path: string, headers: Record<string, string>) =>
	fetch(`http://localhost:${port}${path}`, { headers })

/**
 * Compile every lane before the storm. Elysia JITs a route on its first hit,
 * and a cold compile under a connection burst stalls Bun's accept loop long
 * enough for the queue to overflow into RSTs. Warming is pure transport
 * hygiene — it changes nothing the scenarios assert, so callers wipe the
 * telemetry it produces before measuring.
 */
const warm = async (port: number, paths: string[] = ['/']) => {
	for (const path of paths)
		expect((await get(port, path, { 'x-id': 'warmup' })).status).toBe(200)
}

describe('abort provenance window under concurrency', () => {
	it('never leaks a window between 200 concurrent server requests', async () => {
		// Refutes: request B observes the window request A opened (a torn
		// set→check→clear cycle) and wrongly defers, or A's window is missed
		// under load and degrades to eager. Neither may happen even once.
		const classified = new Map<string, string>()
		const syncSlotStayedCold = new Map<string, boolean>()
		const asyncArmedOwnSignal = new Map<string, boolean>()

		const app = new Elysia()
			// first hook in the chain: runs right after the route's entry probe
			// and ahead of every other emitted arming site, so it reads the
			// classification verdict verbatim
			.derive((context: any) => {
				classified.set(idOf(context.request), classify(context))

				return {}
			})
			.get('/sync', (context: any) => {
				// the payoff: a lane that cannot suspend never materializes
				// `request.signal` at all
				syncSlotStayedCold.set(
					idOf(context.request),
					context['~sig'] === undefined
				)

				return 'ok'
			})
			.get('/async', async (context: any) => {
				await Bun.sleep(1)

				// post-suspension the slot must be armed, and armed with THIS
				// request's signal — a cross-armed slot would be the race
				asyncArmedOwnSignal.set(
					idOf(context.request),
					context['~sig'] instanceof AbortSignal &&
						context['~sig'] === context.request.signal
				)

				return 'ok'
			})

		const port = await listen(app)
		await warm(port, ['/sync', '/async'])
		classified.clear()
		syncSlotStayedCold.clear()
		asyncArmedOwnSignal.clear()

		const ids: string[] = []
		const responses = await storm(
			Array.from({ length: 200 }, (_, i) => {
				const id = `${i % 2 ? 'async' : 'sync'}:${i}`
				ids.push(id)

				return () =>
					get(port, i % 2 ? '/async' : '/sync', { 'x-id': id })
			})
		)

		for (const response of responses) expect(response.status).toBe(200)

		expect(classified.size).toBe(200)
		// the core race assertion: a single spurious 'eager' is a window
		// integrity violation
		expect(
			[...classified.values()].filter((v) => v !== 'deferred')
		).toEqual([])

		const syncIds = ids.filter((id) => id.startsWith('sync:'))
		const asyncIds = ids.filter((id) => id.startsWith('async:'))

		expect(
			syncIds.filter((id) => syncSlotStayedCold.get(id) !== true)
		).toEqual([])
		expect(
			asyncIds.filter((id) => asyncArmedOwnSignal.get(id) !== true)
		).toEqual([])

		expect(origin.request).toBeUndefined()
	})

	it('keeps pristine, substituted and self-aborting requests apart when interleaved', async () => {
		// Refutes the semantic race: a `.wrap()` HOC that substitutes the
		// Request per-request must miss the window every time it substitutes —
		// otherwise a synchronously self-aborted request would be classified
		// deferred and its abort silently ignored, letting the second
		// beforeHandle run after the abort. Interleaving all three classes at
		// once is what makes a shared module slot dangerous.
		const classified = new Map<string, string>()
		const sideEffect = new Set<string>()
		const controllers = new Map<string, AbortController>()

		const app = new Elysia()
			.wrap(
				(next: any) => (request: Request, server: unknown) =>
					request.headers.get('x-sub') === '1'
						? next(
								new Request(request, {
									signal: controllers.get(idOf(request))!
										.signal
								}),
								server
							)
						: next(request, server)
			)
			.request((context: any) => {
				classified.set(idOf(context.request), classify(context))
			})
			.beforeHandle((context: any) => {
				if (context.request.headers.get('x-abort') === '1')
					controllers.get(idOf(context.request))!.abort()
			})
			.beforeHandle((context: any) => {
				sideEffect.add(idOf(context.request))
			})
			.get('/', () => 'ok')

		const port = await listen(app)
		// pristine warmup: no `x-sub`, so it needs no controller
		await warm(port)
		classified.clear()
		sideEffect.clear()

		const pristine: string[] = []
		const substituted: string[] = []
		const aborted: string[] = []

		const requests = Array.from({ length: 180 }, (_, i) => {
			const lane = i % 3
			const id = `${lane}:${i}`

			controllers.set(id, new AbortController())

			if (lane === 0) {
				pristine.push(id)

				return () => get(port, '/', { 'x-id': id })
			}

			if (lane === 1) {
				substituted.push(id)

				return () => get(port, '/', { 'x-id': id, 'x-sub': '1' })
			}

			aborted.push(id)

			return () =>
				get(port, '/', { 'x-id': id, 'x-sub': '1', 'x-abort': '1' })
		})

		const responses = await storm(requests)
		const bodies = await Promise.all(responses.map((r) => r.text()))

		for (const response of responses) expect(response.status).toBe(200)

		expect(pristine.length).toBe(60)
		expect(substituted.length).toBe(60)
		expect(aborted.length).toBe(60)

		// pristine: untouched original ⇒ deferred, pipeline runs whole
		expect(
			pristine.filter((id) => classified.get(id) !== 'deferred')
		).toEqual([])
		expect(pristine.filter((id) => !sideEffect.has(id))).toEqual([])

		// substituted but never aborted ⇒ eager, pipeline still runs whole
		expect(
			substituted.filter((id) => classified.get(id) !== 'eager')
		).toEqual([])
		expect(substituted.filter((id) => !sideEffect.has(id))).toEqual([])

		// substituted and synchronously self-aborted ⇒ eager, and the pinned
		// semantic: the second beforeHandle must NOT run
		expect(aborted.filter((id) => classified.get(id) !== 'eager')).toEqual(
			[]
		)
		expect(aborted.filter((id) => sideEffect.has(id))).toEqual([])

		for (let i = 0; i < responses.length; i++) {
			const id = `${i % 3}:${i}`
			expect(bodies[i]).toBe(i % 3 === 2 ? '' : 'ok')
			expect(classified.has(id)).toBe(true)
		}

		expect(origin.request).toBeUndefined()
	})

	it('never lets a delayed next() adopt a stale or foreign window', async () => {
		// Refutes: a `.wrap()` HOC that holds the ORIGINAL request across an
		// await and calls next() later. Its own window is long closed, and
		// other requests are opening windows the whole time — it must classify
		// eager, never match a neighbour's slot, and never disturb the
		// concurrent pristine traffic on another server.
		const delayedClass = new Map<string, string>()
		const pristineClass = new Map<string, string>()

		const delayedApp = new Elysia()
			.wrap((next: any) => async (request: Request, server: unknown) => {
				// jittered, deterministic: 0-2ms (warmup ids have no index)
				await Bun.sleep(Number(idOf(request).split(':')[1]) % 3 || 0)

				return next(request, server)
			})
			.request((context: any) => {
				delayedClass.set(idOf(context.request), classify(context))
			})
			.get('/', () => 'ok')

		const pristineApp = new Elysia()
			.request((context: any) => {
				pristineClass.set(idOf(context.request), classify(context))
			})
			.get('/', () => 'ok')

		const delayedPort = await listen(delayedApp)
		const pristinePort = await listen(pristineApp)
		await warm(delayedPort)
		await warm(pristinePort)
		delayedClass.clear()
		pristineClass.clear()

		const delayedIds: string[] = []
		const pristineIds: string[] = []
		const requests: (() => Promise<Response>)[] = []

		// interleaved dispatch storm across both servers at once
		for (let i = 0; i < 100; i++) {
			const delayedId = `d:${i}`
			const pristineId = `p:${i}`

			delayedIds.push(delayedId)
			pristineIds.push(pristineId)

			requests.push(() => get(delayedPort, '/', { 'x-id': delayedId }))
			requests.push(() => get(pristinePort, '/', { 'x-id': pristineId }))
		}

		const responses = await storm(requests)

		for (const response of responses) expect(response.status).toBe(200)

		expect(delayedClass.size).toBe(100)
		expect(pristineClass.size).toBe(100)
		expect(
			delayedIds.filter((id) => delayedClass.get(id) !== 'eager')
		).toEqual([])
		expect(
			pristineIds.filter((id) => pristineClass.get(id) !== 'deferred')
		).toEqual([])

		expect(origin.request).toBeUndefined()
	})

	it('keeps handle() eager while the same app serves a deferred storm', async () => {
		// Refutes: in-process `app.handle` sharing the module slot with live
		// server traffic. The nested case is the sharpest one — a handle()
		// dispatched from INSIDE an open window, where a boolean "we are in Bun"
		// flag (rather than request identity) would wrongly defer a foreign
		// request that may already be aborted.
		const classified = new Map<string, string>()
		const nested: Promise<Response>[] = []
		const nestedIds: string[] = []

		const app = new Elysia()
			.request((context: any) => {
				const id = idOf(context.request)
				classified.set(id, classify(context))

				// fired synchronously while this request's window is open
				if (id.startsWith('s:') && id.endsWith('0')) {
					const nestedId = `n:${id}`
					nestedIds.push(nestedId)
					nested.push(
						app.handle(
							new Request('http://localhost/', {
								headers: { 'x-id': nestedId }
							})
						)
					)
				}
			})
			.get('/', async () => {
				await Bun.sleep(2)

				return 'ok'
			})

		const port = await listen(app)
		// 'warmup' does not match the nesting predicate below
		await warm(port)
		classified.clear()

		const serverIds: string[] = []
		const handleIds: string[] = []
		const requests: (() => Promise<Response>)[] = []

		// alternating tasks share the in-flight pool, and the route holds each
		// server request for 2ms — so every handle() runs while dozens of
		// server requests are mid-flight and windows keep opening around it
		for (let i = 0; i < 100; i++) {
			const serverId = `s:${i}`
			const handleId = `h:${i}`

			serverIds.push(serverId)
			handleIds.push(handleId)

			requests.push(() => get(port, '/', { 'x-id': serverId }))
			requests.push(() =>
				app.handle(
					new Request('http://localhost/', {
						headers: { 'x-id': handleId }
					})
				)
			)
		}

		const responses = await storm(requests)
		const nestedResponses = await Promise.all(nested)

		for (const response of [...responses, ...nestedResponses])
			expect(response.status).toBe(200)

		// 100 server + 100 handle + 10 nested — guards the filters below from
		// passing vacuously on an unpopulated map
		expect(classified.size).toBe(210)
		expect(
			serverIds.filter((id) => classified.get(id) !== 'deferred')
		).toEqual([])
		expect(
			handleIds.filter((id) => classified.get(id) !== 'eager')
		).toEqual([])

		expect(nestedIds.length).toBe(10)
		expect(
			nestedIds.filter((id) => classified.get(id) !== 'eager')
		).toEqual([])

		expect(origin.request).toBeUndefined()
	})
})
