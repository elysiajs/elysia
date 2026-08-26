// @ts-nocheck
import { Elysia, t } from '../../src'
import { describe, expect, it } from 'bun:test'

describe('Native Static Response', () => {
	it('work', async () => {
		const app = new Elysia().get('/', 'Static Content')

		expect(app.router.response['/'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/'].GET.text()).toEqual('Static Content')
	})

	it('handle plugin', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = new Elysia().use(plugin).get('/', 'Static Content')

		expect(app.router.response['/'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/'].GET.text()).toEqual('Static Content')

		expect(app.router.response['/plugin'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/plugin'].GET.text()).toEqual('Plugin')
	})

	it('handle default header', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = new Elysia()
			.headers({ server: 'Elysia' })
			.use(plugin)
			.get('/', 'Static Content')

		expect(app.router.response['/'].GET).toBeInstanceOf(Response)
		expect(app.router.response['/'].GET.headers.get('server')).toBe('Elysia')
		expect(await app.router.response['/'].GET.text()).toEqual('Static Content')

		expect(app.router.response['/plugin'].GET).toBeInstanceOf(Response)
		expect(app.router.response['/plugin'].GET.headers.get('server')).toBe('Elysia')
		expect(await app.router.response['/plugin'].GET.text()).toEqual('Plugin')
	})

	it('turn off by config', async () => {
		const app = new Elysia({ nativeStaticResponse: false }).get(
			'/',
			'Static Content'
		)

		expect(app.router.response).not.toHaveProperty('/')
	})

	it('handle loose path', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = new Elysia().use(plugin).get('/', 'Static Content')

		expect(app.router.response['/'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/'].GET.text()).toEqual('Static Content')

		expect(app.router.response[''].GET).toBeInstanceOf(Response)
		expect(await app.router.response[''].GET.text()).toEqual('Static Content')

		expect(app.router.response['/plugin'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/plugin'].GET.text()).toEqual('Plugin')

		expect(app.router.response['/plugin/'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/plugin/'].GET.text()).toEqual('Plugin')

		const strict = new Elysia({ strictPath: true })
			.use(plugin)
			.get('/', 'Static Content')

		expect(strict.router.response['/'].GET).toBeInstanceOf(Response)
		expect(await strict.router.response['/'].GET.text()).toEqual(
			'Static Content'
		)
		expect(strict.router.response).not.toHaveProperty('')

		expect(strict.router.response['/plugin'].GET).toBeInstanceOf(Response)
		expect(await strict.router.response['/plugin'].GET.text()).toEqual('Plugin')
		expect(strict.router.response).not.toHaveProperty('/plugin/')
	})

	// A natively promoted route is answered from the runtime's route table and
	// never enters the composed handler, so anything that would have run there
	// is silently skipped. Promotion must therefore be refused whenever the
	// route carries something that observes or alters the request/response.
	describe('refuse promotion when the pipeline would be skipped', () => {
		const denied = {
			'request schema (headers)': (app) =>
				app.get('/', 'Static Content', {
					headers: t.Object({
						authorization: t.Literal('Bearer secret')
					})
				}),
			'request schema (query)': (app) =>
				app.get('/', 'Static Content', {
					query: t.Object({ id: t.Numeric() })
				}),
			'request schema (cookie)': (app) =>
				app.get('/', 'Static Content', {
					cookie: t.Object({ session: t.String() })
				}),
			'response schema': (app) =>
				app.get('/', 'Static Content', {
					response: t.Number()
				}),
			'app-level onRequest': (app) =>
				app.onRequest(() => {}).get('/', 'Static Content'),
			'app-level trace': (app) =>
				app.trace(() => {}).get('/', 'Static Content'),
			'app-level mapResponse': (app) =>
				app.mapResponse(() => {}).get('/', 'Static Content'),
			'app-level derive': (app) =>
				app.derive(() => ({})).get('/', 'Static Content'),
			'route-level beforeHandle': (app) =>
				app.get('/', 'Static Content', { beforeHandle: () => {} })
		}

		for (const [name, build] of Object.entries(denied))
			it(`refuse ${name}`, () => {
				const app = build(new Elysia())

				expect(app.router.response['/']?.GET).toBeUndefined()
			})

		// Keeps every case above honest: the guard must not simply disable
		// native promotion outright. Metadata, server lifecycle, the error hook
		// and `onAfterResponse` cannot observe or alter a constant response, so
		// a route carrying only those must stay promoted.
		it('still promote a route nothing can intercept', async () => {
			const app = new Elysia()
				.onStart(() => {})
				.onStop(() => {})
				.onError(() => {})
				.onAfterResponse(() => {})
				.get('/', 'Static Content', {
					detail: { summary: 'home' },
					tags: ['static']
				})

			expect(app.router.response['/'].GET).toBeInstanceOf(Response)
			expect(await app.router.response['/'].GET.text()).toEqual(
				'Static Content'
			)
		})
	})

	// Registration used to run `onRequest` against a synthetic
	// `http://ely.sia/...` request and throw the result away, so a hook with
	// side effects fired at boot for every literal route while never running
	// for a real one.
	it('never invoke a request hook with a synthetic request', () => {
		let calls = 0

		new Elysia()
			.onRequest(() => {
				calls++
			})
			.get('/a', 'A')
			.get('/b', 'B')
			.get('/c', 'C')

		expect(calls).toBe(0)
	})
})
