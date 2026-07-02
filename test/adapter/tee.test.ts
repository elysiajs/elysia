import { describe, it, expect } from 'bun:test'
import { tee } from '../../src/adapter/utils'
import { Elysia } from '../../src'

// H15: tee() drains the source AHEAD of the consumers (the afterResponse/trace
// timing contract) but bounds the unconsumed window so a long/infinite stream
// can't materialise.
describe('tee() bounded drain-ahead (H15)', () => {
	it('caps how far the producer races ahead of the slowest branch', async () => {
		let produced = 0
		async function* src() {
			// infinite
			while (true) {
				produced++
				yield produced
			}
		}

		const cap = 4
		const [client, listener] = await tee(src(), 2, cap)

		// listener drains as fast as it can (afterResponse-style), but it can't
		// pull the source past the slow client + cap
		const drained = (async () => {
			for await (const _ of listener) {
			}
		})()

		// slow client reads only 3
		for (let i = 0; i < 3; i++) await client.next()
		await new Promise((r) => setTimeout(r, 20))

		// producer must not race beyond client(3) + cap(4); allow 1 in-flight
		expect(produced).toBeLessThanOrEqual(3 + cap + 1)

		await client.return?.() // branch 0 return stops the infinite source
		await drained // listener now reaches completion
	})

	it('drains streams shorter than the cap eagerly (server-timing preserved)', async () => {
		async function* src() {
			for (let i = 0; i < 3; i++) yield i
		}

		const [response, listener] = await tee(src(), 2, 64)

		// observer drains fully and reaches completion without the client
		const seen: number[] = []
		for await (const v of listener) seen.push(v)
		expect(seen).toEqual([0, 1, 2])

		// the response branch still sees every value
		const got: number[] = []
		for await (const v of response) got.push(v)
		expect(got).toEqual([0, 1, 2])
	})

	// H9 — the window cap was denominated in ENTRIES only: 64 x 1MB chunks =
	// 68MB pinned per slow-client stream. The producer must also gate on a
	// byte cap, whichever hits first.
	it('caps the window in bytes, not just entries (H9)', async () => {
		let produced = 0
		async function* megachunks() {
			while (true) {
				produced++
				yield new Uint8Array(1024 * 1024)
			}
		}

		const [client, listener] = await tee(megachunks(), 2)

		const drained = (async () => {
			for await (const _ of listener) {
			}
		})()

		// client reads one chunk then stalls
		await client.next()
		await new Promise((r) => setTimeout(r, 30))

		// 4MiB default byte cap with 1MB chunks → single-digit read-ahead,
		// not the 64-entry count cap (was 65-66 chunks / +68MB RSS)
		expect(produced).toBeLessThanOrEqual(8)

		await client.return?.()
		await drained
	})

	// H9/C2 regression — the H9 test above uses a SLOW client, so both branches
	// never drain to the byte-cap boundary and the resume-gate interaction is
	// never stressed. A FAST consumer draining both branches past the 4MiB cap
	// within <8 large chunks used to WEDGE: `wakeAll()` runs trims before the
	// producer parks, so a deferred splice never freed the consumed prefix, the
	// resume gate read an inflated window and stayed shut, and the producer
	// parked forever — afterResponse/trace never fired, Context pinned (the C2
	// leak the rewrite fixed). Guarded by a wall-clock timeout so a wedge fails
	// loud instead of hanging the suite.
	it('does not wedge when a fast consumer drains both branches past the byte cap (H9/C2)', async () => {
		async function* megachunks() {
			for (let i = 0; i < 30; i++) yield new Uint8Array(1024 * 1024)
		}

		const [a, b] = await tee(megachunks(), 2) // default cap 64 / 4MiB bytes

		const count = (branch: AsyncIterableIterator<unknown>) =>
			(async () => {
				let n = 0
				for await (const _ of branch) n++
				return n
			})()

		const counts = (await Promise.race([
			Promise.all([count(a), count(b)]),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('tee wedged')), 1000)
			)
		])) as number[]

		expect(counts).toEqual([30, 30])
	})

	it('streams every chunk of a large-chunk response and fires afterResponse once (H9/C2 e2e)', async () => {
		let afterResponse = 0

		const app = new Elysia()
			.afterResponse(() => {
				afterResponse++
			})
			.get('/big', async function* () {
				for (let i = 0; i < 30; i++) yield new Uint8Array(1024 * 1024)
			})

		const res = await app.handle(new Request('http://localhost/big'))
		const reader = res.body!.getReader()

		const received = (await Promise.race([
			(async () => {
				let n = 0
				while (true) {
					const { done } = await reader.read()
					if (done) break
					n++
				}
				return n
			})(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('response wedged')), 2000)
			)
		])) as number

		await new Promise((r) => setTimeout(r, 20))
		expect(received).toBe(30)
		expect(afterResponse).toBe(1)
	})

	// C2 — branches were async generators: parked at an in-body await, their
	// .return() queued until the STALLED source produced again = never. The
	// abort-unwind (afterResponse/trace, Context release) hangs off branch-0
	// return, so it must take effect synchronously without another chunk.
	it('unwinds on branch-0 return while the source is stalled (C2)', async () => {
		let observerDone = false
		let hang!: () => void

		async function* stalled() {
			yield 'first'
			await new Promise<void>((resolve) => {
				hang = resolve
			})
			yield 'never'
		}

		const [client, listener] = await tee(stalled(), 2)

		const drained = (async () => {
			for await (const _ of listener) {
			}
			observerDone = true
		})()

		await client.next() // consume 'first' — source now parked on the stall
		await client.return?.() // client abort — must NOT need another chunk

		await Promise.race([
			drained,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('observer wedged')), 500)
			)
		])
		expect(observerDone).toBe(true)
		hang()
	})

	it('fires afterResponse when the client aborts a stalled stream (C2 e2e)', async () => {
		let afterResponse = 0
		let hang!: () => void

		const app = new Elysia()
			.afterResponse(() => {
				afterResponse++
			})
			.get('/sse', async function* () {
				yield 'first'
				await new Promise<void>((resolve) => {
					hang = resolve
				})
				yield 'never'
			})

		const controller = new AbortController()
		const res = await app.handle(
			new Request('http://localhost/sse', { signal: controller.signal })
		)
		const reader = res.body!.getReader()
		await reader.read()
		controller.abort()
		try {
			await reader.cancel()
		} catch {}

		// must fire WITHOUT the source producing another chunk
		await new Promise((r) => setTimeout(r, 200))
		expect(afterResponse).toBe(1)
		hang()
	})

	// A mid-stream source error must reach the consumers (like direct
	// iteration) instead of dying as an unhandled rejection while branches
	// end "clean".
	it('propagates a source error to every branch', async () => {
		async function* failing() {
			yield 1
			throw new Error('boom')
		}

		const [a, b] = await tee(failing(), 2)

		expect((await a.next()).value).toBe(1)
		expect(a.next()).rejects.toThrow('boom')

		const drain = async () => {
			for await (const _ of b) {
			}
		}
		expect(drain()).rejects.toThrow('boom')
	})
})
