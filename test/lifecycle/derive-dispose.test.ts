import { Elysia, t } from '../../src'
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
		// `inference.afterResponse` via `markAllAccessed` and the route leaves
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
	const abortDuringErrorHook = async (
		app: Elysia<any, any, any, any, any, any, any, any>
	) => {
		app.listen(0)
		await Bun.sleep(1)

		const controller = new AbortController()
		const response = fetch(`http://localhost:${app.server!.port}/`, {
			signal: controller.signal
		}).catch(() => undefined)

		await Bun.sleep(5)
		controller.abort()
		await response
		await Bun.sleep(40)
		await app.stop()
	}

	it('does not run afterResponse on an aborted non-derive route', async () => {
		const log: string[] = []

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
					throw new Error('boom')
				})
		)

		// HEAD behaviour: a disconnect means the hook never sees a response
		expect(log).toEqual([])
	})

	it('drains an aborted derive route through the same lane', async () => {
		const log: string[] = []

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
					throw new Error('boom')
				})
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
		const stack = new AsyncDisposableStack()
		stack.use(disposable(log, 'first'))
		stack.use({
			[Symbol.dispose]() {
				throw new Error('disposer failed')
			}
		})
		stack.use(disposable(log, 'last'))

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
})
