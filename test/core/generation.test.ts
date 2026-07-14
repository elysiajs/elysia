import { Elysia, t } from '../../src'
import { generationOf, frozenRootOf } from '../../src/generation'
import { describe, expect, it } from 'bun:test'

const req = (path: string, init?: RequestInit) =>
	new Request(`http://e.ly${path}`, init)

// B6 — root-local semantic freeze. These pin the seal contract that does NOT
// depend on the (orchestrator-owned) Q4 late-mutation arbitration: generation
// publication timing, per-root isolation, the accessor, hot-reload swaps, failed
// setup, introspect, and the mutation guard firing on each authoring API family.

describe('B6 generation — publication', () => {
	it('an unsealed app has no generation; generationOf throws', () => {
		const app = new Elysia().get('/', () => 'ok')

		expect(app['~generation']).toBeUndefined()
		expect(() => generationOf(app)).toThrow('before the app was sealed')
		// frozenRootOf falls back to the live root while unsealed.
		expect(frozenRootOf(app)).toBe(app)
	})

	it('first handle() publishes exactly one generation', async () => {
		const app = new Elysia().get('/', () => 'ok')

		await app.handle(req('/'))

		const generation = generationOf(app)
		expect(generation['~config']).toBe(app['~config'])
		expect(generation['~ext']).toBe(app['~ext'])
		expect(generation.routeTable).toBe(app['~routeTable'])
		// frozenRootOf now routes through the published generation.
		expect(frozenRootOf(app)).toBe(generation)

		// A second request does not republish.
		const same = generationOf(app)
		await app.handle(req('/'))
		expect(generationOf(app)).toBe(same)
	})

	it('.compile() seals; explicit', () => {
		const app = new Elysia().get('/', () => 'ok')
		expect(app['~generation']).toBeUndefined()

		app.compile()
		expect(generationOf(app)).toBe(app['~generation'])
	})
})

describe('B6 generation — delayed plugins resolved before serve', () => {
	it('an async plugin route is served on the first request AFTER drain, generation publishes once', async () => {
		const app = new Elysia().use(
			Promise.resolve(new Elysia().get('/late', () => 'late'))
		)

		// Draining resolves the async plugin but keeps the app authorable — no
		// generation yet (A6: publish only post-resolution AND at a real seal).
		await app.modules
		expect(app['~generation']).toBeUndefined()

		// The first real request seals: the async route is reachable, published once.
		const res = await app.handle(req('/late'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('late')

		expect(generationOf(app)).toBe(app['~generation'])
	})
})

describe('B6 generation — per-root isolation', () => {
	it('the same plugin sealed under two roots keeps each root its own resolved state', async () => {
		const shared = () => (app: Elysia) =>
			app
				.decorate('who', 'shared')
				.model('M', t.Object({ a: t.String() }))
				.get('/p', ({ who }: any) => who)

		const a = new Elysia().decorate('root', 'A').use(shared())
		const b = new Elysia().decorate('root', 'B').use(shared())

		await a.handle(req('/p'))
		await b.handle(req('/p'))

		const ga = generationOf(a)
		const gb = generationOf(b)

		// Each generation carries its OWN ext (decorators / models), never shared.
		expect(ga['~ext']).not.toBe(gb['~ext'])
		expect((ga['~ext'] as any).decorator.root).toBe('A')
		expect((gb['~ext'] as any).decorator.root).toBe('B')
		expect((ga['~ext'] as any).decorator.who).toBe('shared')
		expect((gb['~ext'] as any).decorator.who).toBe('shared')
		expect((ga['~ext'] as any).models.M).toBeDefined()
	})
})

describe('B6 generation — hot-reload swap', () => {
	it('~newGeneration republishes; a new capability is visible only after the swap', async () => {
		const app = new Elysia().get('/a', () => 'a')
		await app.handle(req('/a'))
		const previous = generationOf(app)

		// Route added via the internal unseal path (mirrors dev hot-reload editing
		// the source and re-running the module).
		;(app as any)['~generation'] = undefined
		app.get('/b', () => 'b')
		app['~newGeneration']()

		expect(generationOf(app)).not.toBe(previous)
		expect((await app.handle(req('/b'))).status).toBe(200)
		expect((await app.handle(req('/a'))).status).toBe(200)
	})

	it('concurrent requests around a swap each observe a coherent generation (never mixed)', async () => {
		const app = new Elysia().get('/a', () => 'a')
		await app.handle(req('/a'))
		const previous = generationOf(app)

		// Fire a burst of requests, swapping in the middle. Each response is a
		// coherent 200 for a route present in SOME generation — never a torn
		// half-old/half-new dispatch (the swap only publishes after a full rebuild).
		const before = Promise.all(
			Array.from({ length: 8 }, () => app.handle(req('/a')))
		)
		;(app as any)['~generation'] = undefined
		app.get('/b', () => 'b')
		app['~newGeneration']()
		const after = Promise.all(
			Array.from({ length: 8 }, () => app.handle(req('/b')))
		)

		for (const r of await before) expect(r.status).toBe(200)
		for (const r of await after) expect(r.status).toBe(200)
		expect(generationOf(app)).not.toBe(previous)
	})
})

describe('B6 generation — failed setup publishes nothing', () => {
	it('a synchronous throw during a functional plugin leaves no generation', () => {
		const boom = () => {
			throw new Error('setup boom')
		}
		const app = new Elysia().get('/', () => 'ok')

		expect(() =>
			app.use(() => {
				boom()
				return new Elysia()
			})
		).toThrow('setup boom')

		// The failed setup neither served nor sealed.
		expect(app['~generation']).toBeUndefined()
	})

	it('an async build failure publishes no generation and no server', async () => {
		let reject!: (e: unknown) => void
		const pending = new Promise<Elysia>((_, r) => (reject = r))
		const app = new Elysia().get('/x', () => 'x').use(pending)

		reject(new Error('async setup boom'))
		try {
			await app.modules
		} catch {}

		// The failed async plugin drained; nothing sealed.
		expect(app['~generation']).toBeUndefined()
		expect(app.server).toBeUndefined()
	})
})

describe('B6 generation — introspect (Q15)', () => {
	it('app-side config.introspect surfaces on the generation', async () => {
		const app = new Elysia({ introspect: true }).get('/', () => 'ok')
		await app.handle(req('/'))
		expect(generationOf(app).introspect).toBe(true)
	})

	it('a plugin declaring introspect seals its host into introspection', async () => {
		const plugin = new Elysia({
			name: 'introspected',
			introspect: true
		})

		const app = new Elysia().use(plugin).get('/', () => 'ok')
		await app.handle(req('/'))
		expect(generationOf(app).introspect).toBe(true)
	})

	it('introspect defaults to false', async () => {
		const app = new Elysia().get('/', () => 'ok')
		await app.handle(req('/'))
		expect(generationOf(app).introspect).toBe(false)
	})
})

describe('B6 generation — post-seal mutation throws (Q4)', () => {
	const sealed = async () => {
		const app = new Elysia().get('/', () => 'ok')
		await app.handle(req('/'))
		return app
	}

	it('every authoring API family throws after first handle()', async () => {
		const cases: Array<[string, (a: any) => unknown]> = [
			['get (verb)', (a) => a.get('/x', () => 'x')],
			['post (verb)', (a) => a.post('/x', () => 'x')],
			['use', (a) => a.use(new Elysia().get('/u', () => 'u'))],
			['decorate', (a) => a.decorate('d', 1)],
			['state', (a) => a.state('s', 1)],
			['model', (a) => a.model('M', t.Object({}))],
			['beforeHandle', (a) => a.beforeHandle(() => {})],
			['transform', (a) => a.transform(() => {})],
			['parse', (a) => a.parse(() => {})],
			['mapResponse', (a) => a.mapResponse(() => {})],
			['guard', (a) => a.guard({ query: t.Object({}) }, (x: any) => x)],
			['as', (a) => a.as('global')],
			['macro', (a) => a.macro({ m: { resolve: () => ({}) } })],
			['error', (a) => a.error({ E: class extends Error {} })],
			['headers', (a) => a.headers({ 'x-a': '1' })],
			['parser', (a) => a.parser('p', () => ({}))],
			['wrap', (a) => a.wrap((f: any) => f)],
			['setup', (a) => a.setup(() => {})],
			['cleanup', (a) => a.cleanup(() => {})]
		]

		for (const [name, mutate] of cases) {
			const app = await sealed()
			expect(() => mutate(app), name).toThrow('after the app was sealed')
		}
	})

	it('mutation throws after .compile() and after listen (port 0)', async () => {
		const compiled = new Elysia().get('/', () => 'ok')
		compiled.compile()
		expect(() => compiled.get('/x', () => 'x')).toThrow(
			'after the app was sealed'
		)

		const listening = new Elysia().get('/', () => 'ok')
		try {
			listening.listen(0)
			await (listening as any).modules
			expect(() => listening.decorate('d', 1)).toThrow(
				'after the app was sealed'
			)
		} finally {
			await listening.stop?.(true)
		}
	})
})
