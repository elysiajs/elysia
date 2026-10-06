import { AsyncLocalStorage } from 'node:async_hooks'

import { Elysia, t, createContext } from '../../src'
import { emittedSource } from '../utils'
import { drainDisposables } from '../../src/handler/utils'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import {
	materialise,
	materialiseHandlers,
	registerManifest
} from '../aot/_manifest'

import { describe, expect, it, afterEach } from 'bun:test'

// `derive()` values implementing Symbol.dispose / Symbol.asyncDispose are
// released per request, after the response and after the user's own `defer()`
// callbacks. A leaked connection per request is the failure this prevents, so
// every lane that can produce a response has to reach the drain.

const drain = () => Bun.sleep(1)

const disposable = (log: string[], name: string) => ({
	name,
	[Symbol.dispose]() {
		log.push(name)
	}
})

const source = (app: any) => emittedSource(app)

// `body`: what the handler answers from the resource it received, so a
// key the walk cannot see is not mistaken for a resource nobody got
const requests = async (
	app: Elysia<any, any, any, any, any, any, any, any>,
	body: string | ((i: number) => string) = 'ok',
	paths = ['/']
) => {
	for (let i = 0; i < 3; i++)
		for (const path of paths)
			expect(await app.handle(path).then((x) => x.text())).toBe(
				typeof body === 'string' ? body : body(i)
			)

	await drain()
}

const hiddenPoolApp = (log: string[]) =>
	new Elysia()
		.decorate(
			'cache',
			Object.defineProperty(new (class Cache {})(), 'pool', {
				value: disposable(log, 'pool'),
				enumerable: false
			})
		)
		.derive(({ cache }: any) => ({
			pool: cache.pool,
			tx: disposable(log, 'tx')
		}))
		.get('/', ({ pool }: any) => pool.name)

describe('derive dispose', () => {
	it('disposes after the response, never before the handler runs', async () => {
		const log: string[] = []
		let seenInHandler: string[] = []

		const app = new Elysia()
			.derive(() => ({ db: disposable(log, 'db') }))
			.get('/', ({ db }) => {
				// the handler still owns the resource
				seenInHandler = [...log]
				return db.name
			})

		expect(await app.handle('/').then((x) => x.text())).toBe('db')
		expect(seenInHandler).toEqual([])

		await drain()
		expect(log).toEqual(['db'])
	})

	it('prefers Symbol.asyncDispose over Symbol.dispose', async () => {
		const log: string[] = []

		const app = new Elysia()
			.derive(() => ({
				db: {
					[Symbol.dispose]() {
						log.push('sync')
					},
					async [Symbol.asyncDispose]() {
						await Bun.sleep(0)
						log.push('async')
					}
				}
			}))
			.get('/', () => 'ok')

		await app.handle('/')
		// the disposer itself awaits a 0 ms timer registered after this one
		await Bun.sleep(5)

		// an async disposer must be awaited, so it wins when both exist
		expect(log).toEqual(['async'])
	})

	it('disposes in reverse registration order, after the user defer queue', async () => {
		const log: string[] = []

		const app = new Elysia()
			// a dependency acquired first must outlive the service built on it
			.derive(() => ({ dependency: disposable(log, 'dependency') }))
			.derive(() => ({ service: disposable(log, 'service') }))
			.get('/', ({ defer }) => {
				defer(() => {
					log.push('defer')
				})

				return 'ok'
			})

		await app.handle('/')
		await drain()

		expect(log).toEqual(['defer', 'service', 'dependency'])
	})

	it('disposes the same instance once when it is exposed under two keys', async () => {
		const log: string[] = []
		const shared = disposable(log, 'shared')

		const app = new Elysia()
			.derive(() => ({ a: shared, b: shared }))
			.get('/', () => 'ok')

		await app.handle('/')
		await drain()

		// the first key is on the context before the second is scanned, on both
		// the keyed and the keyless path
		expect(log).toEqual(['shared'])
	})

	it('KNOWN GAP: mapDerive cannot dedupe an instance against itself', async () => {
		const log: string[] = []
		const shared = disposable(log, 'shared')

		const app = new Elysia()
			.mapDerive((context) => ({ ...context, a: shared, b: shared }))
			.get('/', () => 'ok')

		await app.handle('/')
		await drain()

		// `mapDerive` registers against the PRE-swap context, which by
		// definition holds neither key, so an instance exposed under two keys is
		// released twice. Expose it once, or use `derive`
		expect(log).toEqual(['shared', 'shared'])
	})

	it('reads each key once on the keyed path, registering what it assigns', () => {
		const emitted = source(
			new Elysia().derive(() => ({ db: { id: 1 } })).get('/', () => 'ok')
		)

		// one read per key, registered before the assignment: the instance the
		// context exposes is the instance recorded, even for an accessor
		expect(emitted).toContain('_v=tmp["db"];dsp(c,_v);c["db"]=_v')
	})

	it('merges symbol keys through the keyless fallback', async () => {
		const marker = Symbol('marker')

		// a computed key bails key extraction, so this is the keyless merge -
		// which iterates `Reflect.ownKeys`; `Object.keys` would drop the symbol
		const app = new Elysia()
			.derive(() => ({ [marker]: 'sym-val', plain: 'x' }) as any)
			.get('/', (context: any) => `${context[marker]}/${context.plain}`)

		expect(await app.handle('/').then((x) => x.text())).toBe('sym-val/x')
	})

	it('reads an accessor once on the keyless fallback too', async () => {
		const log: string[] = []
		let reads = 0

		const app = new Elysia()
			// a spread/non-literal return cannot be key-extracted, so this takes
			// the `Object.assign` fallback
			.derive((): any => {
				const derived = {}
				Object.defineProperty(derived, 'db', {
					enumerable: true,
					get: () => {
						reads++
						return disposable(log, 'read-' + reads)
					}
				})

				return derived
			})
			.get('/', ({ db }: any) => db.name)

		const body = await app.handle('/').then((x) => x.text())
		await drain()

		// The fallback materializes into one copy, registers from it and merges
		// that copy, so registration still happens before anything reaches the
		// context (which is what keeps `derive(c => ({ ...c, db }))` from
		// registering `context.server`) while the instance recorded is the
		// instance the handler saw
		expect(reads).toBe(1)
		expect(body).toBe('read-1')
		expect(log).toEqual([body])
	})

	it('tolerates a derive value whose get trap throws', async () => {
		// a strict service/config Proxy is a real pattern; probing it for two
		// symbols must not turn someone else's object into a 500
		const strict = new Proxy(
			{ name: 'svc' },
			{
				get(target: any, key) {
					if (!(key in target))
						throw new Error(`unknown property ${String(key)}`)

					return target[key]
				}
			}
		)

		const app = new Elysia()
			.derive(() => ({ svc: strict }))
			.get('/', ({ svc }: any) => svc.name)

		const response = await app.handle('/')
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('svc')
		await drain()
	})

	it('never registers an inherited key, which resolves to a decorated singleton', async () => {
		const log: string[] = []
		const singleton = disposable(log, 'singleton')

		const app = new Elysia()
			.decorate('shared', singleton)
			// an inherited enumerable key is never merged onto the context, so
			// enumerating it would read `c.shared` off the context prototype
			// and hand a per-request drain the app's singleton
			.derive((): any => Object.create({ shared: singleton }))
			.get('/', ({ shared }: any) => shared.name)

		expect(await app.handle('/').then((x) => x.text())).toBe('singleton')
		await drain()

		expect(log).toEqual([])
	})

	it('never registers an inherited key through mapDerive either', async () => {
		const log: string[] = []
		const singleton = disposable(log, 'singleton')

		const app = new Elysia()
			.decorate('shared', singleton)
			.mapDerive((context): any => {
				const next = Object.create({ shared: singleton })
				return Object.assign(next, context)
			})
			.get('/', () => 'ok')

		await app.handle('/')
		await drain()

		expect(log).toEqual([])
	})

	it('disposes when the handler throws and an error hook answers', async () => {
		const log: string[] = []

		const app = new Elysia()
			.derive(() => ({ db: disposable(log, 'db') }))
			.error(() => 'handled')
			.get('/', () => {
				throw new Error('boom')
			})

		expect(await app.handle('/').then((x) => x.text())).toBe('handled')
		await drain()

		expect(log).toEqual(['db'])
	})

	it('disposes when an error hook returns a Response', async () => {
		const log: string[] = []

		const app = new Elysia()
			.derive(() => ({ db: disposable(log, 'db') }))
			.error(() => new Response('from-hook'))
			.get('/', () => {
				throw new Error('boom')
			})

		expect(await app.handle('/').then((x) => x.text())).toBe('from-hook')
		await drain()

		expect(log).toEqual(['db'])
	})

	it('disposes when the error hook itself throws', async () => {
		const log: string[] = []

		const app = new Elysia()
			.derive(() => ({ db: disposable(log, 'db') }))
			.error(() => {
				throw new Error('hook failed')
			})
			.get('/', () => {
				throw new Error('boom')
			})

		expect((await app.handle('/')).status).toBe(500)
		await drain()

		expect(log).toEqual(['db'])
	})

	it('disposes when a later beforeHandle short-circuits the handler', async () => {
		const log: string[] = []
		let handlerRan = false

		const app = new Elysia()
			.derive(() => ({ db: disposable(log, 'db') }))
			.beforeHandle(() => 'short')
			.get('/', () => {
				handlerRan = true
				return 'never'
			})

		expect(await app.handle('/').then((x) => x.text())).toBe('short')
		expect(handlerRan).toBe(false)
		await drain()

		expect(log).toEqual(['db'])
	})

	it('disposes a mapDerive value through the replaced context', async () => {
		const log: string[] = []

		const app = new Elysia()
			.mapDerive((context) => ({
				...context,
				db: disposable(log, 'db')
			}))
			.get('/', ({ db }: any) => db.name)

		expect(await app.handle('/').then((x) => x.text())).toBe('db')
		await drain()

		expect(log).toEqual(['db'])
	})

	it('carries earlier derive values through a mapDerive context swap', async () => {
		const log: string[] = []

		const app = new Elysia()
			.derive(() => ({ before: disposable(log, 'before') }))
			.mapDerive((context) => ({
				...context,
				after: disposable(log, 'after')
			}))
			.get('/', () => 'ok')

		await app.handle('/')
		await drain()

		// `replaceDeriveContext` builds a new context object; a value recorded
		// on the old one is lost unless the list is carried over
		expect(log).toEqual(['after', 'before'])
	})

	it('disposes an aborted request', async () => {
		const log: string[] = []
		let handlerRan = false
		let release!: () => void

		// the derive is held open until the abort has already happened, so the
		// abort arm is the only path that can produce this response - no timer
		// race against a normal success drain
		const aborted = new Promise<void>((resolve) => {
			release = resolve
		})

		const app = new Elysia()
			.derive(async () => {
				await aborted
				return { connection: disposable(log, 'connection') }
			})
			.get('/', ({ connection }) => {
				handlerRan = true
				return connection.name
			})

		const controller = new AbortController()
		const response = app.handle(
			new Request('http://localhost/', { signal: controller.signal })
		)

		controller.abort()
		release()
		await response

		await Bun.sleep(10)
		// a client disconnect is the most common cause of a leaked resource
		expect(handlerRan).toBe(false)
		expect(log).toEqual(['connection'])
	})

	it('disposes an async generator response only once the stream ends', async () => {
		const log: string[] = []
		const seen: string[][] = []

		const app = new Elysia()
			.derive(() => ({ db: disposable(log, 'db') }))
			.get('/', async function* () {
				seen.push([...log])
				yield 'a'
				await Bun.sleep(2)
				seen.push([...log])
				yield 'b'
				await Bun.sleep(2)
				// the body is still running here, so the resource is still live
				seen.push([...log])
			})

		const response = await app.handle('/')
		expect(await response.text()).toBe('ab')
		await Bun.sleep(20)

		expect(seen).toEqual([[], [], []])
		expect(log).toEqual(['db'])
	})

	it('disposes a sync generator response only once the stream ends', async () => {
		const log: string[] = []
		const seen: string[][] = []

		const app = new Elysia()
			.derive(() => ({ db: disposable(log, 'db') }))
			.get('/', function* () {
				seen.push([...log])
				yield 'a'
				seen.push([...log])
				yield 'b'
				// the body is still running here, so the resource is still live
				seen.push([...log])
			})

		const response = await app.handle('/')
		expect(await response.text()).toBe('ab')
		await Bun.sleep(10)

		expect(seen).toEqual([[], [], []])
		expect(log).toEqual(['db'])
	})

	it('still drains a defer() registered inside a generator body', async () => {
		const log: string[] = []

		const app = new Elysia()
			.derive(() => ({ db: disposable(log, 'db') }))
			.get('/', async function* ({ defer }) {
				defer(() => {
					log.push('defer')
				})

				yield 'a'
			})

		const response = await app.handle('/')
		expect(await response.text()).toBe('a')
		await Bun.sleep(10)

		// the queue is filled after the tee decision, so the drain cannot be
		// gated on it being non-empty
		expect(log).toEqual(['defer', 'db'])
	})

	it('does not turn a derive route into an afterResponse route', () => {
		const withDerive = new Elysia()
			.derive(() => ({ db: { id: 1 } }))
			.get('/', { response: t.String() }, () => 'ok')

		const withAfterResponse = new Elysia()
			.afterResponse(() => {})
			.get('/', { response: t.String() }, () => 'ok')

		const derived = source(withDerive)

		expect(derived).toContain('dds(c)')
		// `hasAfterResponse` drives `responseValue`, `hasSetEffects` and
		// `afterResponseForcesAsync`. Folding derive disposal into it would
		// change every one of those for every `.derive()` app
		expect(derived).not.toContain('c.responseValue=_r')
		expect(source(withAfterResponse)).toContain('c.responseValue=_r')
	})

	it('emits no disposal machinery on a route without derive', () => {
		const plain = source(
			new Elysia().beforeHandle(() => {}).get('/', () => 'ok')
		)

		expect(plain).not.toContain('dds(')
		expect(plain).not.toContain('dsp(')
		expect(plain).not.toContain('tee(')
	})
})

// Derive-only means a disposable is the only thing that can need the drain, so
// the microtask and the tee are both skipped when nothing was recorded. The
// guard is sound because `~dispose` is written only by `dsp`, in the
// beforeHandle phase, so its truthiness is fixed before the tee decision and
// cannot change afterwards - tee and schedule always agree.
describe('derive dispose: derive-only guard', () => {
	const queueCalls = async (app: any) => {
		const original = globalThis.queueMicrotask
		let calls = 0
		globalThis.queueMicrotask = ((fn: () => void) => {
			calls++
			return original(fn)
		}) as typeof queueMicrotask

		try {
			await app.handle('/')
			await Bun.sleep(5)
		} finally {
			globalThis.queueMicrotask = original
		}

		return calls
	}

	it('queues nothing for a derive route whose values are not disposable', async () => {
		const plain = new Elysia()
			.derive(() => ({ user: { id: 1 } }))
			.get('/', ({ user }: any) => String(user.id))

		const log: string[] = []
		const withDisposable = new Elysia()
			.derive(() => ({ user: disposable(log, 'user') }))
			.get('/', ({ user }: any) => user.name)

		// differential: the only difference is whether a value is disposable
		expect(await queueCalls(plain)).toBe(0)
		expect(await queueCalls(withDisposable)).toBeGreaterThan(0)
		expect(log).toEqual(['user'])
	})

	it('gates the schedule and the tee on the same value', () => {
		const emitted = source(
			new Elysia()
				.derive(() => ({ user: { id: 1 } }))
				.get('/', () => 'ok')
		)

		// both, or the tee could create a branch nobody drains
		expect(emitted).toContain("if(c['~dispose']){")
		expect(emitted).toContain("if(c['~dispose']&&_r&&")
	})

	it('leaves a non-derive route abort arm untouched', () => {
		const emitted = source(
			new Elysia()
				.afterResponse(() => {})
				.beforeHandle(() => {})
				.get('/', () => 'ok')
		)

		// Scheduling on abort is for disposal. Extending it to routes that
		// merely have an `afterResponse` hook would fire that hook on client
		// disconnect with no response to report - a silent change for apps that
		// never asked for disposal
		expect(emitted).toContain("if(c['~sig']?.aborted)return emp.clone()")
		expect(emitted).not.toContain("if(c['~sig']?.aborted){")
	})

	it('does not gate when an afterResponse hook is present', () => {
		const emitted = source(
			new Elysia()
				.derive(() => ({ user: { id: 1 } }))
				.get('/', { afterResponse() {} }, () => 'ok')
		)

		expect(emitted).toContain('dds(c)')
		expect(emitted).not.toContain("if(c['~dispose']){")
	})

	it('still streams a generator when the tee is skipped', async () => {
		const app = new Elysia()
			.derive(() => ({ user: { id: 1 } }))
			.get('/', async function* () {
				yield 'a'
				yield 'b'
			})

		const response = await app.handle('/')
		expect(await response.text()).toBe('ab')
	})

	it('streams past the tee entry cap when the tee is skipped', async () => {
		const app = new Elysia()
			.derive(() => ({ user: { id: 1 } }))
			.get('/', async function* () {
				for (let i = 0; i < 200; i++) yield 'x'
			})

		const response = await app.handle('/')
		// `tee` backpressures on its slowest branch at 64 entries, so a tee
		// created without a drain would stall here
		expect(await response.text()).toHaveLength(200)
	})

	it('latches _arf under the same guard as the schedule', () => {
		const emitted = source(
			new Elysia()
				.derive(() => ({ user: { id: 1 } }))
				.get('/', () => {
					throw new Error('boom')
				})
		)

		// `_arf` tells fetch.ts's fallback "the drain is handled". Latching it
		// while the guard skips the drain would strand a `~afterResponse`
		// queue that the fallback would otherwise drain, so the latch has to
		// sit under the same condition.
		//
		// Shape, not behaviour, and deliberately so: in derive-only mode
		// nothing in userland can populate that queue (reaching `defer`, or
		// passing the context to an opaque callee, sets
		// `inference.afterResponse` via `allAccessed` and the route leaves
		// the mode), and nothing can observe `_arf` either - this lane is only
		// emitted when there is no error hook, and an `afterResponse` handler
		// would also leave the mode. The invariant is real; only its emitted
		// form is reachable from a test
		// regex rather than a three-line formatting pin: what matters is that
		// the error-path latch is never reached without the guard
		expect(emitted).toMatch(/if\(c\['~dispose'\]\)c\._arf=true/)
	})

	it('still drains a defer() from a generator body with nothing disposable', async () => {
		const log: string[] = []

		const app = new Elysia()
			.derive(() => ({ user: { id: 1 } }))
			.get('/', async function* ({ defer }) {
				defer(() => {
					log.push('defer')
				})

				yield 'a'
			})

		const response = await app.handle('/')
		expect(await response.text()).toBe('a')
		await Bun.sleep(10)

		// reading `defer` puts the route outside derive-only mode, so the guard
		// never sees a request whose queue it would drop
		expect(log).toEqual(['defer'])
	})
})

// `app.handle()` leaves `context.server` undefined, which is exactly why the
// server-disposal defect was invisible to every other test in this file: a
// derive that carries the context forward (`{ ...context, x }` - the canonical
// mapDerive shape) copies `context.server`, and Bun's `Server` implements
// `Symbol.dispose`. Registering it stops the server mid-request.
describe('derive dispose: under a real server', () => {
	const serve = async (
		app: Elysia<any, any, any, any, any, any, any, any>
	) => {
		app.listen(0)
		await Bun.sleep(1)

		const port = app.server!.port
		const get = () =>
			fetch(`http://localhost:${port}/`).then(async (response) => {
				const body = await response.text()
				return `${response.status}:${body}`
			})

		return { get, stop: () => app.stop() }
	}

	it('keeps serving when a derive spreads the context', async () => {
		const log: string[] = []
		const db = disposable(log, 'db')

		const app = new Elysia()
			.decorate('db', db)
			.derive((context): any => ({ ...context, tenant: 'acme' }))
			.get('/', ({ tenant }: any) => tenant)

		const { get, stop } = await serve(app)
		try {
			// two sequential requests: the second only answers if the first did
			// not dispose `context.server`
			expect(await get()).toBe('200:acme')
			expect(await get()).toBe('200:acme')
			await Bun.sleep(5)

			expect(log).toEqual([])
		} finally {
			await stop()
		}
	})

	it('keeps serving when a mapDerive spreads the context', async () => {
		const log: string[] = []
		const db = disposable(log, 'db')

		const app = new Elysia()
			.decorate('db', db)
			.mapDerive((context): any => ({ ...context, tenant: 'acme' }))
			.get('/', ({ tenant }: any) => tenant)

		const { get, stop } = await serve(app)
		try {
			expect(await get()).toBe('200:acme')
			expect(await get()).toBe('200:acme')
			await Bun.sleep(5)

			expect(log).toEqual([])
		} finally {
			await stop()
		}
	})

	it('does not dispose a decorator a derive merely aliases', async () => {
		const log: string[] = []
		const db = disposable(log, 'db')

		const app = new Elysia()
			.decorate('db', db)
			.derive(({ db }: any) => ({ conn: db }))
			.get('/', ({ conn }: any) => conn.name)

		const { get, stop } = await serve(app)
		try {
			expect(await get()).toBe('200:db')
			expect(await get()).toBe('200:db')
			await Bun.sleep(5)

			// a singleton aliased under a derive key is still a singleton
			expect(log).toEqual([])
		} finally {
			await stop()
		}
	})

	// The error-hook lane emits `schedule` next to `abortCatch`. Reordering it
	// for every route would make a pre-existing `afterResponse` hook fire on
	// client disconnect with no response to report, so the order is swapped
	// only on derive routes - which is the pair below.
	// Abort once the handler has run, not on a timer: `localhost` can take
	// 20 ms to connect, and a request cancelled before the server sees it
	// leaves nothing to drain
	const abortDuringErrorHook = async (
		app: Elysia<any, any, any, any, any, any, any, any>,
		reached: Promise<void>
	) => {
		app.listen(0)
		await Bun.sleep(1)

		const controller = new AbortController()
		const response = fetch(`http://localhost:${app.server!.port}/`, {
			signal: controller.signal
		}).catch(() => undefined)

		// the handler has thrown and the error hook is sleeping
		await reached
		controller.abort()
		await response
		await Bun.sleep(40)
		await app.stop()
	}

	it('does not run afterResponse on an aborted non-derive route', async () => {
		const log: string[] = []
		const reached = Promise.withResolvers<void>()

		await abortDuringErrorHook(
			new Elysia()
				.afterResponse(() => {
					log.push('afterResponse')
				})
				.error(async () => {
					await Bun.sleep(30)
					return 'handled'
				})
				.get('/', () => {
					reached.resolve()
					throw new Error('boom')
				}),
			reached.promise
		)

		// HEAD behaviour: a disconnect means the hook never sees a response
		expect(log).toEqual([])
	})

	it('drains an aborted derive route through the same lane', async () => {
		const log: string[] = []
		const reached = Promise.withResolvers<void>()

		await abortDuringErrorHook(
			new Elysia()
				.derive(() => ({ tx: disposable(log, 'tx') }))
				.afterResponse(() => {
					log.push('afterResponse')
				})
				.error(async () => {
					await Bun.sleep(30)
					return 'handled'
				})
				.get('/', () => {
					reached.resolve()
					throw new Error('boom')
				}),
			reached.promise
		)

		// the mirror: a derive route must still release its resource
		expect(log).toContain('tx')
	})

	it('does not dispose a singleton reached through store', async () => {
		const log: string[] = []
		const pool = disposable(log, 'pool')

		const app = new Elysia()
			.state('pool', pool)
			.derive(({ store }: any) => ({ db: store.pool }))
			.get('/', ({ db }: any) => db.name)

		const { get, stop } = await serve(app)
		try {
			expect(await get()).toBe('200:pool')
			expect(await get()).toBe('200:pool')
			await Bun.sleep(5)

			// the top-level context scan cannot see `store.pool`; the
			// registration-time singleton walk can
			expect(log).toEqual([])
		} finally {
			await stop()
		}
	})

	it('does not dispose a singleton reached through a namespaced decorator', async () => {
		const log: string[] = []
		const db = disposable(log, 'nested')

		const app = new Elysia()
			.decorate('services', { db })
			.derive(({ services }: any) => ({ db: services.db }))
			.get('/', ({ db }: any) => db.name)

		const { get, stop } = await serve(app)
		try {
			expect(await get()).toBe('200:nested')
			expect(await get()).toBe('200:nested')
			await Bun.sleep(5)

			expect(log).toEqual([])
		} finally {
			await stop()
		}
	})

	it("does not dispose a plugin's nested singleton aliased by the parent", async () => {
		const log: string[] = []
		const one = disposable(log, 'one')
		const two = disposable(log, 'two')
		const three = disposable(log, 'three')

		// `#absorbExt` re-walks only the keys the plugin contributed, so every
		// depth the plugin registered has to survive the clone/merge
		const plugin = new Elysia({ name: 'services' })
			.decorate('services', { one, nested: { two, deeper: { three } } })
			.state('pool', { one })

		const app = new Elysia()
			.use(plugin)
			.derive(({ services, store }: any) => ({
				a: services.one,
				b: services.nested.two,
				c: services.nested.deeper.three,
				d: store.pool.one
			}))
			.get('/', ({ a, b, c, d }: any) => [a, b, c, d].length.toString())

		const { get, stop } = await serve(app)
		try {
			expect(await get()).toBe('200:4')
			expect(await get()).toBe('200:4')
			await Bun.sleep(5)

			expect(log).toEqual([])
		} finally {
			await stop()
		}
	})

	it('does not dispose a singleton three levels down', async () => {
		const log: string[] = []
		const client = disposable(log, 'deep')

		const app = new Elysia()
			.decorate('services', { db: { primary: { client } } })
			.derive(({ services }: any) => ({
				conn: services.db.primary.client
			}))
			.get('/', ({ conn }: any) => conn.name)

		const { get, stop } = await serve(app)
		try {
			expect(await get()).toBe('200:deep')
			await Bun.sleep(5)

			// within the depth-4 walk ceiling
			expect(log).toEqual([])
		} finally {
			await stop()
		}
	})

	it('KNOWN GAP: a value put into store at runtime is disposed per request', async () => {
		const log: string[] = []
		const late = disposable(log, 'late')

		const app = new Elysia()
			.state('late', null as any)
			.derive(({ store }: any) => {
				// assigned after registration, so the walk never saw it
				store.late ??= late
				return { db: store.late }
			})
			.get('/', ({ db }: any) => db.name)

		const { get, stop } = await serve(app)
		try {
			expect(await get()).toBe('200:late')
			await Bun.sleep(5)

			// Documents the ceiling: the singleton walk runs at registration, so
			// a value written into `store` at runtime is indistinguishable from
			// a per-request resource. Register it with `.state()` instead
			expect(log).toEqual(['late'])
		} finally {
			await stop()
		}
	})

	it('still disposes a value the derive introduced, per request', async () => {
		const log: string[] = []
		let minted = 0

		const app = new Elysia()
			.derive(() => ({ tx: disposable(log, 'tx-' + ++minted) }))
			.get('/', ({ tx }: any) => tx.name)

		const { get, stop } = await serve(app)
		try {
			// positive control: the guard must not turn disposal off wholesale
			expect(await get()).toBe('200:tx-1')
			expect(await get()).toBe('200:tx-2')
			await Bun.sleep(5)

			expect(log).toEqual(['tx-1', 'tx-2'])
		} finally {
			await stop()
		}
	})

	it('does not dispose a pool a decorated instance hides', async () => {
		const log: string[] = []

		const { get, stop } = await serve(hiddenPoolApp(log))
		try {
			expect(await get()).toBe('200:pool')
			expect(await get()).toBe('200:pool')
			await Bun.sleep(5)

			expect(log).toEqual(['tx', 'tx'])
		} finally {
			await stop()
		}
	})
})

// A client library often keeps its connection under a symbol or a
// non-enumerable key. Held by a decorator or the store, it is still shared:
// a derive handing it out introduced nothing, so it must not dispose it
describe('derive dispose: singletons under a symbol or non-enumerable key', () => {
	const client = Symbol('client')
	const hidden = (value: unknown) =>
		Object.defineProperty({}, 'client', { value, enumerable: false })

	// A client class often hides its pool from `JSON.stringify` and logs
	class Client {
		declare pool: unknown

		constructor(pool: unknown) {
			Object.defineProperty(this, 'pool', {
				value: pool,
				enumerable: false
			})
		}
	}

	const countingOwnKeys = (count: () => void) =>
		new Proxy(
			{},
			{
				ownKeys(target) {
					count()

					return Reflect.ownKeys(target)
				}
			}
		)

	type Case = [
		name: string,
		body: string,
		build: (log: string[]) => Elysia<any, any, any, any, any, any, any, any>
	]

	const cases: Case[] = [
		[
			'a decorated resource under a symbol key',
			'db',
			(log) =>
				new Elysia()
					.decorate('db', { [client]: disposable(log, 'db') })
					.derive(({ db }: any) => ({ conn: db[client] }))
					.get('/', ({ conn }: any) => conn.name)
		],
		[
			'a resource a decorated instance holds under a symbol key',
			'db',
			(log) => {
				class Client {
					[client] = disposable(log, 'db')
				}

				return new Elysia()
					.decorate('db', new Client())
					.derive(({ db }: any) => ({ conn: db[client] }))
					.get('/', ({ conn }: any) => conn.name)
			}
		],
		[
			'a decorated resource under a non-enumerable key',
			'db',
			(log) =>
				new Elysia()
					.decorate('db', hidden(disposable(log, 'db')))
					.derive(({ db }: any) => ({ conn: db.client }))
					.get('/', ({ conn }: any) => conn.name)
		],
		[
			'a stored resource under a symbol key',
			'pool',
			(log) =>
				new Elysia()
					.state('pool', { [client]: disposable(log, 'pool') })
					.derive(({ store }: any) => ({ conn: store.pool[client] }))
					.get('/', ({ conn }: any) => conn.name)
		],
		[
			'a stored resource under a non-enumerable key',
			'pool',
			(log) =>
				new Elysia()
					.state('pool', hidden(disposable(log, 'pool')))
					.derive(({ store }: any) => ({ conn: store.pool.client }))
					.get('/', ({ conn }: any) => conn.name)
		],
		[
			'a non-enumerable store entry, which only the seal walk sees',
			'pool',
			(log) =>
				new Elysia()
					.state((store) =>
						Object.defineProperty(store, 'pool', {
							value: disposable(log, 'pool'),
							enumerable: false
						})
					)
					.derive(({ store }: any) => ({ conn: store.pool }))
					.get('/', ({ conn }: any) => conn.name)
		],
		...[false, true].map(
			(precompile): Case => [
				`a resource a decorated instance holds under a non-enumerable key${precompile ? ' with precompile' : ''}`,
				'pool',
				(log) =>
					new Elysia({ precompile })
						.decorate('db', new Client(disposable(log, 'pool')))
						.derive(({ db }: any) => ({ conn: db.pool }))
						.get('/', ({ conn }: any) => conn.name)
			]
		),
		[
			'a resource a stored instance holds under a non-enumerable key',
			'pool',
			(log) =>
				new Elysia()
					.state('db', new Client(disposable(log, 'pool')))
					.derive(({ store }: any) => ({ conn: store.db.pool }))
					.get('/', ({ conn }: any) => conn.name)
		]
	]

	for (const [name, body, build] of cases)
		it(`does not dispose ${name}`, async () => {
			const log: string[] = []

			await requests(build(log), body)

			expect(log).toEqual([])
		})

	it('still disposes what the derive minted from a decorated class', async () => {
		const log: string[] = []
		let minted = 0

		class Tx {
			id = ++minted;

			[Symbol.dispose]() {
				log.push(`tx-${this.id}`)
			}
		}

		// the class and the symbol-held resource are shared, an instance the
		// derive builds from the class is its own
		const app = new Elysia()
			.decorate('Tx', Tx)
			.decorate('db', { [client]: disposable(log, 'db') })
			.derive(({ Tx, db }: any) => ({ shared: db[client], tx: new Tx() }))
			.get('/', ({ shared }: any) => shared.name)

		await requests(app, 'db')

		expect(log).toEqual(['tx-1', 'tx-2', 'tx-3'])
	})

	it("never walks a function's non-enumerable keys, which are the runtime's", async () => {
		let walked = 0
		function factory() {}
		// stands in for the `prototype` every regular function and class
		// has: walking it doubled the seal walk over decorated functions
		factory.prototype = countingOwnKeys(() => walked++)

		const app = new Elysia()
			.decorate('factory', factory)
			.state('factory', factory)
			.get('/', () => 'ok')

		await requests(app)

		expect(walked).toBe(0)
	})

	it('never walks a non-enumerable global, which the runtime may build lazily', async () => {
		let walked = 0
		const key = '__elysiaHiddenGlobal'
		// stands in for a lazy global: reading its descriptor builds it, and
		// walking all of them cost +7 MB on a decorated `globalThis`
		Object.defineProperty(globalThis, key, {
			value: countingOwnKeys(() => walked++),
			enumerable: false,
			configurable: true
		})

		try {
			const app = new Elysia()
				.decorate('global', globalThis)
				.get('/', () => 'ok')

			await requests(app)

			expect(walked).toBe(0)
		} finally {
			delete (globalThis as any)[key]
		}
	})

	// Marking is best effort: introspecting a value the app was handed must
	// not fail `.decorate()`, `.state()` or the first request
	const throwingProxies = () => [
		new Proxy(
			{},
			{
				ownKeys() {
					throw new Error('ownKeys trap')
				}
			}
		),
		new Proxy(
			{ name: 'svc', [client]: {} },
			{
				getOwnPropertyDescriptor(target, key) {
					if (key === client) throw new Error('descriptor trap')

					return Reflect.getOwnPropertyDescriptor(target, key)
				}
			}
		)
	]

	it('registers and serves a proxy whose traps throw', async () => {
		const [keys, descriptor] = throwingProxies()

		const app = new Elysia()
			.decorate('keys', keys)
			.decorate('descriptor', descriptor)
			.state('keys', keys)
			.state('descriptor', descriptor)
			.get('/', () => 'ok')

		await requests(app)
	})

	it('serves a proxy whose traps throw, added where only the seal walk sees it', async () => {
		const holder: Record<string, unknown> = {}
		const box: Record<string, unknown> = {}

		const app = new Elysia()
			.decorate('holder', holder)
			.state('box', box)
			.get('/', () => 'ok')

		;[holder.keys, holder.descriptor] = throwingProxies()
		;[box.keys, box.descriptor] = throwingProxies()

		await requests(app)
	})

	it('does not dispose a resource behind a proxy whose prototype trap throws', async () => {
		const log: string[] = []
		// telling plain from not fails, the enumerable keys are still there
		const service = new Proxy(
			{ db: disposable(log, 'db') },
			{
				getPrototypeOf() {
					throw new Error('prototype trap')
				}
			}
		)

		const app = new Elysia()
			.decorate('service', service)
			.state('service', service)
			.derive(({ service, store }: any) => ({
				a: service.db,
				b: store.service.db
			}))
			.get('/', ({ a, b }: any) => `${a.name},${b.name}`)

		await requests(app, 'db,db')

		expect(log).toEqual([])
	})

	it("never walks an error's non-enumerable keys, which the runtime builds on read", async () => {
		let walked = 0
		const error = new Error('decorated')
		// stands in for `stack`: reading its descriptor builds the string
		Object.defineProperty(error, 'detail', {
			value: countingOwnKeys(() => walked++),
			enumerable: false
		})

		const app = new Elysia()
			.decorate('error', error)
			.state('error', error)
			.get('/', () => 'ok')

		await requests(app)

		expect(walked).toBe(0)
	})

	it('never lists the keys of a decorated typed array or DataView', async () => {
		// listing a view's keys lists every index: a 1 MB Buffer took ~0.5 s
		// and ~250 MB to walk
		const buffer = Buffer.alloc(1 << 20)
		const view = new DataView(buffer.buffer)

		let listed = 0
		const spied = [
			[Reflect, 'ownKeys'],
			[Object, 'keys'],
			[Object, 'getOwnPropertySymbols'],
			[Object, 'getOwnPropertyDescriptor']
		] as const
		const originals = spied.map(([owner, key]) => (owner as any)[key])
		spied.forEach(([owner, key], i) => {
			;(owner as any)[key] = function (
				this: unknown,
				target: unknown,
				...rest: unknown[]
			) {
				if (target === buffer || target === view) listed++

				return originals[i].call(this, target, ...rest)
			}
		})

		try {
			const app = new Elysia()
				.decorate('buffer', buffer)
				.state('view', view)
				.get('/', () => 'ok')

			await requests(app)
		} finally {
			spied.forEach(([owner, key], i) => {
				;(owner as any)[key] = originals[i]
			})
		}

		expect(listed).toBe(0)
	})

	it('does not dispose a resource a shallow path reaches after a deep hidden one', async () => {
		// the hidden path reaches `holder` at the depth limit first; the
		// shallow `pool.holder` must still mark what `holder` holds
		for (const precompile of [false, true])
			for (const kind of ['derive', 'mapDerive'] as const) {
				const log: string[] = []
				const holder = { resource: disposable(log, 'shared') }
				const pool = Object.defineProperty(
					new (class Pool {})(),
					'hidden',
					{
						value: { next: { next: { next: holder } } }
					}
				) as any
				pool.holder = holder

				const app = (
					new Elysia({ precompile }).decorate('pool', pool) as any
				)
					[kind]((context: any) => ({
						...context,
						resource: context.pool.holder.resource
					}))
					.get('/', ({ resource }: any) => resource.name)

				await requests(app, 'shared')

				expect({ precompile, kind, log }).toEqual({
					precompile,
					kind,
					log: []
				})
			}
	})

	it('does not dispose a resource one table entry reaches deep and another shallow', async () => {
		const log: string[] = []
		const holder = { resource: disposable(log, 'shared') }
		const a: Record<string, unknown> = {}
		const b: Record<string, unknown> = {}

		const app = new Elysia()
			.decorate('a', a)
			.decorate('b', b)
			.derive(({ b }: any) => ({ resource: b.holder.resource }))
			.get('/', ({ resource }: any) => resource.name)

		// written after `.decorate()`, so only the seal walk sees either path:
		// `a` reaches `holder` at the depth limit before `b` reaches it early
		a.x = { y: { z: { w: holder } } }
		b.holder = holder

		await requests(app, 'shared')

		expect(log).toEqual([])
	})

	it('marks four levels below a decorator, KNOWN GAP: not a fifth', async () => {
		const log: string[] = []

		const app = new Elysia()
			.decorate('root', {
				a: {
					b: {
						c: {
							four: disposable(log, 'four'),
							d: { five: disposable(log, 'five') }
						}
					}
				}
			})
			.derive(({ root }: any) => ({
				four: root.a.b.c.four,
				five: root.a.b.c.d.five
			}))
			.get('/', ({ four, five }: any) => `${four.name},${five.name}`)

		await requests(app, 'four,five')

		// the walk is bounded: a resource held deeper is disposed per request
		expect(log).toEqual(['five', 'five', 'five'])
	})

	it('walks a cycle once and still finds what it holds', async () => {
		const log: string[] = []
		const node: Record<string, unknown> = {
			resource: disposable(log, 'cyclic')
		}
		node.self = node
		node.next = { back: node }

		const app = new Elysia()
			.decorate('graph', node)
			.derive(({ graph }: any) => ({
				resource: graph.next.back.self.resource
			}))
			.get('/', ({ resource }: any) => resource.name)

		await requests(app, 'cyclic')

		expect(log).toEqual([])
	})

	it('queues an object many references share once', async () => {
		const log: string[] = []
		const shared = disposable(log, 'shared')
		const rows = Array.from({ length: 100 }, () => Array(1000).fill(shared))

		// a queue entry per reference held 1M entries for 1000 x 1000
		let queued = 0
		const push = Array.prototype.push
		Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
			for (const item of items) if (item === shared) queued++

			return push.apply(this, items)
		}

		try {
			const app = new Elysia()
				.decorate('rows', rows)
				.derive(({ rows }: any) => ({ resource: rows[99][999] }))
				.get('/', ({ resource }: any) => resource.name)

			await requests(app, 'shared')
		} finally {
			Array.prototype.push = push
		}

		expect(queued).toBeLessThan(10)
		expect(log).toEqual([])
	})

	it('KNOWN GAP: a resource set on a typed array or DataView is disposed per request', async () => {
		const log: string[] = []
		const buffer = Object.assign(new Uint8Array(1), {
			client: disposable(log, 'buffer')
		})
		const view = Object.assign(new DataView(new ArrayBuffer(1)), {
			client: disposable(log, 'view')
		})

		const app = new Elysia()
			.decorate('buffer', buffer)
			.state('view', view)
			.derive(({ buffer, store }: any) => ({
				a: buffer.client,
				b: store.view.client
			}))
			.get('/', ({ a, b }: any) => `${a.name},${b.name}`)

		await requests(app, 'buffer,view')

		// a buffer view is never walked, a property set on one included: its
		// keys can't be listed without listing every index
		expect(log).toEqual([
			'view',
			'buffer',
			'view',
			'buffer',
			'view',
			'buffer'
		])
	})

	it("does not dispose a plugin's resource under a symbol or non-enumerable key", async () => {
		const log: string[] = []

		// the plugin's copy used to drop both keys, so the derive saw nothing
		const plugin = new Elysia({ name: 'hidden-resources' })
			.decorate('a', { [client]: disposable(log, 'symbol') })
			.decorate('b', hidden(disposable(log, 'hidden')))

		const app = new Elysia()
			.use(plugin)
			.derive(({ a, b }: any) => ({ x: a[client], y: b.client }))
			.get('/', ({ x, y }: any) => `${x.name},${y.name}`)

		await requests(app, 'symbol,hidden')

		expect(log).toEqual([])
	})
})

// Elysia never runs a user getter to learn what is shared: a getter can't
// tell a shared value from one it makes per request, and it may build, throw
// or reject. A plugin's getter is read once, by the consumer's copy at `.use()`
describe('derive dispose: getters', () => {
	const lazy = (log: string[], name: string) => {
		let client: ReturnType<typeof disposable> | undefined

		return {
			get client() {
				return (client ??= disposable(log, name))
			}
		}
	}

	it('KNOWN GAP: a client a root decorator holds behind a getter is disposed per request', async () => {
		const log: string[] = []

		const app = new Elysia()
			.decorate('db', lazy(log, 'client'))
			.derive(({ db }: any) => ({ client: db.client }))
			.get('/', ({ client }: any) => client.name)

		await requests(app, 'client')

		// the walk never runs the getter, which can't tell a shared client
		// from one it makes per request: hold the client in data instead
		expect(log).toEqual(['client', 'client', 'client'])
	})

	it("does not dispose a plugin's lazily created client, which .use() read once", async () => {
		const log: string[] = []
		let reads = 0
		let client: ReturnType<typeof disposable> | undefined

		const plugin = new Elysia({ name: 'lazy-client' })
			.decorate('db', {
				get client() {
					reads++
					return (client ??= disposable(log, 'client'))
				}
			})
			.derive('global', ({ db }: any) => ({ client: db.client }))
			.get('/plugin', ({ client }: any) => client.name)

		const app = new Elysia()
			.use(plugin)
			.derive(({ db }: any) => ({ again: db.client }))
			.get('/', ({ again }: any) => again.name)

		await requests(app, 'client', ['/', '/plugin'])

		expect(reads).toBe(1)
		expect(log).toEqual([])
	})

	it('never reads a decorated or stored getter', async () => {
		let reads = 0
		const pool = {
			get client() {
				reads++
				return {}
			}
		}

		const app = new Elysia()
			.decorate('pool', pool)
			.state('pool', pool)
			.derive(() => ({ tx: disposable([], 'tx') }))
			.get('/', () => 'ok')

		void app.fetch
		await requests(app, 'ok')

		expect(reads).toBe(0)
	})

	it('never reads a getter that rejects, which would end the process', async () => {
		let reads = 0

		const app = new Elysia()
			.decorate('pool', {
				get client() {
					reads++
					return Promise.reject(new Error('unused getter'))
				}
			})
			.derive(() => ({ tx: disposable([], 'tx') }))
			.get('/', () => 'ok')

		await requests(app, 'ok')
		await Bun.sleep(5)

		expect(reads).toBe(0)
	})

	it('disposes the transaction a request-scoped getter returns, every request', async () => {
		const log: string[] = []
		const scope = new AsyncLocalStorage<{
			tx?: ReturnType<typeof disposable>
		}>()
		let minted = 0

		const app = new Elysia()
			.decorate('pool', {
				get tx() {
					const store = scope.getStore()!

					return (store.tx ??= disposable(log, `tx-${++minted}`))
				}
			})
			.derive(({ pool }: any) => ({ tx: pool.tx }))
			.get('/', ({ tx }: any) => tx.name)

		for (let i = 1; i <= 3; i++)
			expect(
				await scope.run({}, () => app.handle('/')).then((x) => x.text())
			).toBe(`tx-${i}`)
		await drain()

		expect(log).toEqual(['tx-1', 'tx-2', 'tx-3'])
	})

	it('disposes what a getter mints, which only the derive reads', async () => {
		const log: string[] = []
		let minted = 0

		const app = new Elysia()
			.decorate('pool', {
				get tx() {
					return disposable(log, `tx-${++minted}`)
				}
			})
			.derive(({ pool }: any) => ({ tx: pool.tx }))
			.get('/', ({ tx }: any) => tx.name)

		await requests(app, (i) => `tx-${i + 1}`)

		expect(minted).toBe(3)
		expect(log).toEqual(['tx-1', 'tx-2', 'tx-3'])
	})

	it('does not dispose a decorator member the table held behind a getter', async () => {
		const log: string[] = []
		let minted = 0

		// the context copies each member once; that copy is the shared one
		const app = new Elysia()
			.decorate(() => ({
				get conn() {
					return disposable(log, `conn-${++minted}`)
				}
			}))
			.derive(({ conn }: any) => ({ alias: conn }))
			.get('/', ({ alias }: any) => alias.name)

		const body = await app.handle('/').then((x) => x.text())
		expect(body).toStartWith('conn-')
		await requests(app, body)

		expect(log).toEqual([])
	})

	// the identity scan's `for..in` never sees a symbol key
	for (const viaPlugin of [false, true])
		it(`does not dispose ${viaPlugin ? "a plugin's" : 'a'} decorator member under a symbol key`, async () => {
			const log: string[] = []
			const key = Symbol('client')
			let minted = 0

			const members = () => ({
				get [key]() {
					return disposable(log, `client-${++minted}`)
				}
			})

			const base: Elysia<any, any, any, any, any, any, any, any> =
				viaPlugin
					? new Elysia().use(
							new Elysia({ name: 'symbol-member' }).decorate(
								members
							)
						)
					: new Elysia().decorate(members)

			const app = base
				.derive((context: any) => ({ client: context[key] }))
				.get('/', ({ client }: any) => client.name)

			await requests(app, 'client-1')

			expect(log).toEqual([])
		})

	it('does not dispose what an inherited getter returned when .use() copied it', async () => {
		const log: string[] = []
		const client = disposable(log, 'client')
		let reads = 0

		// an enumerable getter on a polluted Object.prototype: the copy reads
		// it once, like any key `for..in` reaches
		Object.defineProperty(Object.prototype, '__elysiaInheritedClient', {
			get(this: { flag?: boolean }) {
				if (this?.flag !== true) return

				reads++
				return client
			},
			enumerable: true,
			configurable: true
		})

		try {
			const plugin = new Elysia({ name: 'inherited-getter' }).decorate(
				'config',
				{ flag: true }
			)

			const app = new Elysia()
				.use(plugin)
				.derive(({ config }: any) => ({
					client: config.__elysiaInheritedClient
				}))
				.get('/', ({ client }: any) => client.name)

			expect(reads).toBe(1)
			await requests(app, 'client')

			expect(reads).toBe(1)
			expect(log).toEqual([])
		} finally {
			delete (Object.prototype as any).__elysiaInheritedClient
		}
	})

	it('does not dispose a member added to the exported context class', async () => {
		const log: string[] = []
		const app = new Elysia().decorate('pool', {})

		// an enumerable member nothing marked: the `for..in` scan still sees it
		createContext(app).prototype.inherited = disposable(log, 'inherited')

		app.derive((context: any) => ({ client: context.inherited })).get(
			'/',
			({ client }: any) => client.name
		)

		await requests(app, 'inherited')

		expect(log).toEqual([])
	})
})

describe('drainDisposables', () => {
	// The generated drain and the fetch-level fallback share this helper, so
	// its contract is pinned directly
	const captureErrors = async (context: any) => {
		const reported: unknown[] = []
		const original = console.error
		console.error = (e: unknown) => reported.push(e)

		try {
			await drainDisposables(context)
		} finally {
			console.error = original
		}

		return reported
	}

	it('releases the recorded stack LIFO and contains a failure', async () => {
		const log: string[] = []
		const stack = [
			() => log.push('first'),
			() => { throw new Error('disposer failed') },
			() => log.push('last')
		]

		const reported = await captureErrors({ '~dispose': stack })

		// the response is already gone, so a failing disposer is reported and
		// the remaining ones still run
		expect(log).toEqual(['last', 'first'])
		expect(reported).toHaveLength(1)
	})

	it('is a no-op when nothing was recorded', async () => {
		await drainDisposables({})
	})

	it('contains a clobbered reserved key instead of throwing', async () => {
		// `~dispose` is reserved; a derive that returns it replaces the stack.
		// The request must survive - the failure is reported, not thrown
		const reported = await captureErrors({ '~dispose': 'clobbered' })

		expect(reported).toHaveLength(1)
	})
})

describe('derive dispose: AOT', () => {
	afterEach(() => {
		delete process.env.ELYSIA_AOT_BUILD
		Compiled.clear()
		Validator.clear()
	})

	it('disposes through a frozen handler manifest', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()

		const build = (log: string[]) =>
			new Elysia()
				.derive(() => ({ db: disposable(log, 'db') }))
				.get('/', ({ db }) => db.name)

		;(build([]) as any).compile()

		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		expect(handlers).toHaveLength(1)
		// the frozen artifact has to carry the registration and the drain, and
		// both aliases have to resolve through the params registry
		expect(handlers[0]!.code).toContain('_v=tmp["db"];dsp(c,_v);c["db"]=_v')
		expect(handlers[0]!.code).toContain('await dds(c)')
		expect(handlers[0]!.alias.split(',')).toContain('dsp')
		expect(handlers[0]!.alias.split(',')).toContain('dds')

		registerManifest({
			validators: materialise(validators),
			handlers: materialiseHandlers(handlers)
		})

		delete process.env.ELYSIA_AOT_BUILD

		const log: string[] = []
		const frozen = build(log)
		;(frozen as any).compile()

		expect(await frozen.handle('/').then((x) => x.text())).toBe('db')
		await Bun.sleep(10)

		expect(log).toEqual(['db'])
	})

	it('tells shared from introduced the same through a frozen handler manifest', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()

		hiddenPoolApp([]).compile()

		const handlers = endHandlerCapture()
		registerManifest({
			validators: materialise(endValidatorCapture()),
			handlers: materialiseHandlers(handlers)
		})

		delete process.env.ELYSIA_AOT_BUILD

		const log: string[] = []
		const frozen = hiddenPoolApp(log)
		frozen.compile()

		expect(handlers).toHaveLength(1)
		for (let i = 0; i < 2; i++)
			expect(await frozen.handle('/').then((x) => x.text())).toBe('pool')
		await Bun.sleep(10)

		expect(log).toEqual(['tx', 'tx'])
	})
})
