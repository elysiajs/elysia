import { Elysia, t } from '../../src'
import { generationOf, frozenRootOf } from '../../src/generation'
import { describe, expect, it } from 'bun:test'

const req = (path: string, init?: RequestInit) =>
	new Request(`http://e.ly${path}`, init)

describe('sealed generation publication', () => {
	it('generationOf throws before sealing and frozenRootOf returns the live app', () => {
		const app = new Elysia().get('/', () => 'ok')

		expect(app['~generation']).toBeUndefined()
		expect(() => generationOf(app)).toThrow('before the app was sealed')
		expect(frozenRootOf(app)).toBe(app)
	})

	it('the first handle publishes one generation and later handles reuse it', async () => {
		const app = new Elysia().get('/', () => 'ok')

		await app.handle(req('/'))

		const generation = generationOf(app)
		expect(generation['~config']).toBe(app['~config'])
		expect(generation['~ext']).toBe(app['~ext'])
		expect(generation.routeTable).toBe(app['~routeTable'])
		expect(frozenRootOf(app)).toBe(generation)

		const same = generationOf(app)
		await app.handle(req('/'))
		expect(generationOf(app)).toBe(same)
	})

	it('.compile publishes a generation', () => {
		const app = new Elysia().get('/', () => 'ok')
		expect(app['~generation']).toBeUndefined()

		app.compile()
		expect(generationOf(app)).toBe(app['~generation'])
	})
})

describe('sealed generation plugin resolution', () => {
	it('resolving an async plugin stays authorable until its first request seals the app', async () => {
		const app = new Elysia().use(
			Promise.resolve(new Elysia().get('/late', () => 'late'))
		)

		await app.modules
		expect(app['~generation']).toBeUndefined()

		const res = await app.handle(req('/late'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('late')

		expect(generationOf(app)).toBe(app['~generation'])
	})
})

describe('sealed generation root isolation', () => {
	it('keeps root-specific state separate when two apps use the same plugin', async () => {
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

		expect(ga['~ext']).not.toBe(gb['~ext'])
		expect((ga['~ext'] as any).decorator.root).toBe('A')
		expect((gb['~ext'] as any).decorator.root).toBe('B')
		expect((ga['~ext'] as any).decorator.who).toBe('shared')
		expect((gb['~ext'] as any).decorator.who).toBe('shared')
		expect((ga['~ext'] as any).models.M).toBeDefined()
	})
})

describe('sealed generation replacement', () => {
	it('~newGeneration publishes routes added since the previous generation', async () => {
		const app = new Elysia().get('/a', () => 'a')
		await app.handle(req('/a'))
		const previous = generationOf(app)

		;(app as any)['~generation'] = undefined
		app.get('/b', () => 'b')
		app['~newGeneration']()

		expect(generationOf(app)).not.toBe(previous)
		expect((await app.handle(req('/b'))).status).toBe(200)
		expect((await app.handle(req('/a'))).status).toBe(200)
	})

	it('requests around a swap observe complete old or new generations', async () => {
		const app = new Elysia().get('/a', () => 'a')
		await app.handle(req('/a'))
		const previous = generationOf(app)

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

describe('sealed generation setup failure', () => {
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

		expect(app['~generation']).toBeUndefined()
		expect(app.server).toBeUndefined()
	})
})

describe('sealed generation introspection', () => {
	it('copies app config.introspect to the generation', async () => {
		const app = new Elysia({ introspect: true }).get('/', () => 'ok')
		await app.handle(req('/'))
		expect(generationOf(app).introspect).toBe(true)
	})

	it('enables introspection when a plugin requests it', async () => {
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

describe('sealed generation immutability', () => {
	const sealed = async () => {
		const app = new Elysia().get('/', () => 'ok')
		await app.handle(req('/'))
		return app
	}

	it('every authoring API family throws after first handle', async () => {
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

	it('authoring mutations throw after .compile and .listen', async () => {
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
