import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

// `.decorate()` values implementing Symbol.dispose / Symbol.asyncDispose are
// singletons, so they are released once, on stop, after every `cleanup`
// handler - user cleanup is still allowed to use a decorated client.
//
// Disposal is recorded when the value is accepted, not scanned off the final
// decorator table: `.use()` clones plain objects (dropping symbol keys), a
// same-name merge folds a plugin's instance away, and a later override makes
// the previous value unreachable. All three would silently leak.

const disposable = (log: string[], name: string) => ({
	name,
	[Symbol.dispose]() {
		log.push(name)
	}
})

// The generic `stop()` lane, without binding a port
const withFakeServer = (
	app: Elysia<any, any, any, any, any, any, any, any>
) => {
	;(app as any).server = { stop() {} }
	return app
}

describe('decorate dispose', () => {
	it('disposes on stop, in reverse order, after user cleanup', async () => {
		const log: string[] = []

		const app = new Elysia()
			.decorate('dependency', disposable(log, 'dependency'))
			.decorate('service', disposable(log, 'service'))
			.cleanup((instance) => {
				// cleanup must still see a live decorator
				log.push(
					'cleanup:' +
						(instance as any)['~ext'].decorator.service.name
				)
			})

		await withFakeServer(app).stop()

		expect(log).toEqual(['cleanup:service', 'service', 'dependency'])
	})

	it('disposes an asyncDispose decorator', async () => {
		const log: string[] = []

		const app = new Elysia().decorate('db', {
			async [Symbol.asyncDispose]() {
				await Bun.sleep(1)
				log.push('async')
			}
		})

		await withFakeServer(app).stop()

		expect(log).toEqual(['async'])
	})

	it('disposes every value of the object form once', async () => {
		const log: string[] = []
		const shared = disposable(log, 'shared')

		const app = new Elysia().decorate({
			a: shared,
			b: shared,
			c: disposable(log, 'c'),
			plain: { no: 'disposer' }
		})

		await withFakeServer(app).stop()

		expect(log).toEqual(['c', 'shared'])
	})

	it('disposes the instance the context exposes, not a re-read accessor', async () => {
		const log: string[] = []
		let reads = 0

		const source = {}
		Object.defineProperty(source, 'db', {
			enumerable: true,
			get: () => disposable(log, 'read-' + ++reads)
		})

		const app = new Elysia()
			.decorate(source as any)
			.get('/', ({ db }: any) => db.name)

		withFakeServer(app)
		// the merge already materialized the accessor into the table, so
		// recording must read the table - re-reading the source yields a second
		// instance, which would be disposed while the live one leaks
		const exposed = await app.handle('/').then((x) => x.text())
		await app.stop()

		expect(log).toEqual([exposed])
	})

	it('disposes an object-form value whose symbol a same-name merge dropped', async () => {
		const log: string[] = []

		const plugin = new Elysia({ name: 'object-collide' }).decorate({
			client: { existing: true }
		})

		const incoming = {
			fresh: true,
			[Symbol.dispose]: () => log.push('incoming')
		}

		// `mergeDeep` copies string keys only, so the merged table value has no
		// disposer - the accepted original is what has to be recorded
		const app = new Elysia().use(plugin).decorate({ client: incoming })

		await withFakeServer(app).stop()

		expect(log).toEqual(['incoming'])
	})

	it('disposes every instance the mapper form returns, once each', async () => {
		const log: string[] = []

		const app = new Elysia()
			.decorate('first', disposable(log, 'first'))
			.decorate((rest) => ({
				...rest,
				second: disposable(log, 'second')
			}))

		await withFakeServer(app).stop()

		// `first` is carried through the spread, but it was already recorded
		expect(log).toEqual(['second', 'first'])
	})

	it('disposes a decorated function', async () => {
		const log: string[] = []

		const fn = () => 'called'
		;(fn as any)[Symbol.dispose] = () => log.push('fn')

		const app = new Elysia().decorate('fn', fn)

		await withFakeServer(app).stop()

		expect(log).toEqual(['fn'])
	})

	it('disposes a plugin class instance and a plugin plain object', async () => {
		const log: string[] = []

		class Client {
			[Symbol.dispose]() {
				log.push('class')
			}
		}

		const classPlugin = new Elysia({ name: 'class-plugin' }).decorate(
			'client',
			new Client()
		)
		const plainPlugin = new Elysia({ name: 'plain-plugin' }).decorate(
			'plain',
			// `.use()` clones plain objects with `for..in`, so the symbol is
			// lost on the context - the recorded original still disposes
			{ [Symbol.dispose]: () => log.push('plain') }
		)

		const app = new Elysia().use(classPlugin).use(plainPlugin)

		await withFakeServer(app).stop()

		expect(log.sort()).toEqual(['class', 'plain'])
	})

	it('disposes a plugin instance the parent overwrote under the same name', async () => {
		const log: string[] = []

		class PluginClient {
			[Symbol.dispose]() {
				log.push('plugin')
			}
		}

		const plugin = new Elysia({ name: 'collide' }).decorate(
			'client',
			new PluginClient()
		)

		const app = new Elysia()
			.use(plugin)
			.decorate('client', disposable(log, 'root'))
			.get('/', ({ client }: any) =>
				String(client instanceof PluginClient)
			)

		// a non-override merge keeps the plugin's object and copies the parent's
		// string keys onto it, so the surviving IDENTITY is the plugin's
		expect(await app.handle('/').then((x) => x.text())).toBe('true')

		await withFakeServer(app).stop()

		// the surviving instance is released; the parent's rejected value is
		// NOT - disposing a value the app never adopted would close a resource
		// the user may still hold
		expect(log).toEqual(['plugin'])
	})

	it('does not dispose a named value a non-override merge rejected', async () => {
		const log: string[] = []
		const first = disposable(log, 'first')
		const second = disposable(log, 'second')

		const app = new Elysia()
			.decorate('db', first)
			.decorate('db', second)
			.get('/', ({ db }: any) => db.name)

		// `.decorate()` appends, so the first value wins
		expect(await app.handle('/').then((x) => x.text())).toBe('first')

		await withFakeServer(app).stop()

		// `second` never reached the context; the user may still be holding it
		expect(log).toEqual(['first'])
	})

	it('runs every disposer and preserves a single failure unchanged', async () => {
		const log: string[] = []
		const failure = new Error('dispose failed')

		const app = new Elysia()
			.decorate('first', disposable(log, 'first'))
			.decorate('second', {
				[Symbol.dispose]() {
					throw failure
				}
			})

		let error: unknown
		try {
			await withFakeServer(app).stop()
		} catch (cause) {
			error = cause
		}

		expect(error).toBe(failure)
		expect(log).toEqual(['first'])
	})

	it('nests two failing disposers as SuppressedError', async () => {
		const first = new Error('first failed')
		const second = new Error('second failed')

		const app = new Elysia()
			.decorate('first', {
				[Symbol.dispose]() {
					throw first
				}
			})
			.decorate('second', {
				[Symbol.dispose]() {
					throw second
				}
			})

		let error: any
		try {
			await withFakeServer(app).stop()
		} catch (cause) {
			error = cause
		}

		// `AsyncDisposableStack` releases LIFO, so `second` is disposed first and
		// its error becomes the SUPPRESSED one; the outer `.error` comes from
		// `first`, the last disposer to run
		expect(error).toBeInstanceOf(SuppressedError)
		expect(error.error).toBe(first)
		expect(error.suppressed).toBe(second)
	})

	it('records each instance once, however often it is re-registered', () => {
		const log: string[] = []
		const app = new Elysia()
			.decorate('first', disposable(log, 'first'))
			// every mapper form re-presents the values it spreads through
			.decorate((rest) => ({ ...rest }))
			.decorate((rest) => ({ ...rest }))
			.decorate((rest) => ({ ...rest }))

		// the list is retained for the app's lifetime, so a re-presented value
		// must not append again
		expect(app['~ext']?.disposable).toHaveLength(1)
	})

	it('tolerates a decorator that loses its disposer before stop', async () => {
		const log: string[] = []
		let live = true

		// a live Proxy can stop offering a disposer between registration and
		// `stop()`; `AsyncDisposableStack.use()` throws TypeError on such a
		// value, so the guard before `use` is what keeps the stop path alive
		const fading = new Proxy(
			{},
			{
				get(_target, key) {
					if (key === Symbol.dispose)
						return live ? () => log.push('fading') : undefined

					return undefined
				}
			}
		)

		const app = new Elysia()
			.decorate('fading', fading)
			.decorate('stable', disposable(log, 'stable'))

		live = false

		await withFakeServer(app).stop()

		// the survivor still disposes, and nothing threw
		expect(log).toEqual(['stable'])
	})

	it('never invokes an accessor while walking a decorated object', async () => {
		let reads = 0

		const services = {}
		Object.defineProperty(services, 'db', {
			enumerable: true,
			get() {
				reads++
				throw new Error('accessor must not run at registration')
			}
		})

		// the singleton walk reads descriptors, never values
		const app = new Elysia().decorate('services', services as any)

		expect(reads).toBe(0)

		await withFakeServer(app).stop()

		expect(reads).toBe(0)
	})

	it('stays linear as plugins are absorbed', () => {
		const service = () => ({
			db: { pool: { size: 1, client: { id: 1 } } },
			cache: { layer: { ttl: 5 } }
		})

		const plugins = []
		for (let i = 0; i < 400; i++)
			plugins.push(
				new Elysia({ name: `boot-${i}` })
					.decorate(`s${i}`, service())
					.state(`t${i}`, service())
			)

		const start = performance.now()
		let app = new Elysia()
		for (const plugin of plugins) app = app.use(plugin) as any
		const elapsed = performance.now() - start

		// Walking the whole merged table on every `.use()` makes this O(N²).
		// N is 400 to separate the arms rather than to tighten the threshold:
		// incremental ~1.2 ms, whole-table ~156 ms. The bound sits ~25x above
		// the former and ~5x below the latter
		expect(elapsed).toBeLessThan(30)
	})

	it('tolerates a decorator whose get trap throws', async () => {
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

		// probing for the two symbols must not crash at registration time
		const app = new Elysia()
			.decorate('svc', strict)
			.get('/', ({ svc }: any) => svc.name)

		expect(await app.handle('/').then((x) => x.text())).toBe('svc')
		await withFakeServer(app).stop()
	})

	it('records nothing when no decorator is disposable', () => {
		const app = new Elysia()
			.decorate('n', 1)
			.decorate('s', 'text')
			.decorate('o', { a: 1 })

		expect(app['~ext']?.disposable).toBeUndefined()
	})

	it('leaves a never-listened stop() synchronous', () => {
		const app = new Elysia().decorate('db', {
			[Symbol.dispose]() {}
		})

		// KNOWN GAP: no server means `stop()` returns before cleanup, so an
		// `app.handle()`-only app disposes nothing
		expect(app.stop()).toBeUndefined()
	})

	it('does not dispose twice across two listen epochs', async () => {
		const serve = Bun.serve
		const log: string[] = []
		;(Bun as any).serve = () => ({
			reload() {},
			stop() {}
		})

		const app = new Elysia().decorate('db', disposable(log, 'db'))

		try {
			app.listen(0)
			await Bun.sleep(0)
			await app.stop(true)

			expect(log).toEqual(['db'])

			app.listen(0)
			await Bun.sleep(0)
			await app.stop(true)

			// a singleton is released once per object lifetime; a relisten
			// would otherwise serve an already-disposed client and dispose it
			// again
			expect(log).toEqual(['db'])
		} finally {
			;(Bun as any).serve = serve
		}
	})
})
