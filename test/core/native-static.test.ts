// @ts-nocheck
import { Elysia, t } from '../../src'
import { describe, expect, it } from 'bun:test'

// Touch `app.fetch` to trigger `#buildRouter()` so the
// `~staticResponse` map is populated. The fetch handler is memoized,
// so this is effectively free for subsequent calls.
const build = (app: any) => {
	void app.fetch
	return app
}

describe('Native Static Response', () => {
	it('work', async () => {
		const app = build(new Elysia().get('/', 'Static Content'))

		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)
	})

	it('handle plugin', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = build(
			new Elysia().use(plugin).get('/', 'Static Content')
		)

		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)

		expect(app['~staticResponse']['/plugin'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/plugin'].GET.text()).toEqual(
			'Plugin'
		)
	})

	it('handle default header', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = build(
			new Elysia()
				.headers({ server: 'Elysia' })
				.use(plugin)
				.get('/', 'Static Content')
		)

		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(app['~staticResponse']['/'].GET.headers.get('server')).toBe(
			'Elysia'
		)
		expect(await app['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)

		expect(app['~staticResponse']['/plugin'].GET).toBeInstanceOf(Response)
		expect(
			app['~staticResponse']['/plugin'].GET.headers.get('server')
		).toBe('Elysia')
		expect(await app['~staticResponse']['/plugin'].GET.text()).toEqual(
			'Plugin'
		)
	})

	it('turn off by config', async () => {
		const app = build(
			new Elysia({ nativeStaticResponse: false }).get(
				'/',
				'Static Content'
			)
		)

		// `~staticResponse` is undefined when the feature is disabled — no
		// entries get populated. `?? {}` so the assertion targets a
		// non-undefined value either way.
		expect(app['~staticResponse'] ?? {}).not.toHaveProperty('/')
	})

	it('handle loose path', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = build(
			new Elysia().use(plugin).get('/', 'Static Content')
		)

		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)

		expect(app['~staticResponse'][''].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse'][''].GET.text()).toEqual(
			'Static Content'
		)

		expect(app['~staticResponse']['/plugin'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/plugin'].GET.text()).toEqual(
			'Plugin'
		)

		expect(app['~staticResponse']['/plugin/'].GET).toBeInstanceOf(
			Response
		)
		expect(await app['~staticResponse']['/plugin/'].GET.text()).toEqual(
			'Plugin'
		)

		const strict = build(
			new Elysia({ strictPath: true })
				.use(plugin)
				.get('/', 'Static Content')
		)

		expect(strict['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(await strict['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)
		expect(strict['~staticResponse']).not.toHaveProperty('')

		expect(strict['~staticResponse']['/plugin'].GET).toBeInstanceOf(
			Response
		)
		expect(await strict['~staticResponse']['/plugin'].GET.text()).toEqual(
			'Plugin'
		)
		expect(strict['~staticResponse']).not.toHaveProperty('/plugin/')
	})

	// A precomputed static Response skips the compiled JS handler entirely,
	// so any hook the JS handler would run per request (mapResponse is what
	// compression/caching plugins use) MUST disqualify the route — otherwise
	// native dispatch serves the unmapped bytes while `app.handle` serves
	// the mapped ones
	describe('eligibility', () => {
		it('bail for app-level mapResponse', async () => {
			const app = build(
				new Elysia()
					.mapResponse(() => new Response('MAPPED'))
					.get('/', 'ok')
			)

			expect(app['~staticResponse'] ?? {}).not.toHaveProperty('/')

			// the JS path is the source of truth for the mapped body
			expect(
				await app.handle(new Request('http://localhost/')).then((x) =>
					x.text()
				)
			).toBe('MAPPED')
		})

		it('bail for route-local mapResponse (scalar and array)', async () => {
			const scalar = build(
				new Elysia().get('/', 'ok', {
					mapResponse: () => new Response('MAPPED')
				})
			)
			expect(scalar['~staticResponse'] ?? {}).not.toHaveProperty('/')

			const array = build(
				new Elysia().get('/', 'ok', {
					mapResponse: [() => new Response('MAPPED')]
				})
			)
			expect(array['~staticResponse'] ?? {}).not.toHaveProperty('/')
		})

		it('bail for guard mapResponse', async () => {
			const app = build(
				new Elysia()
					.guard({ mapResponse: () => new Response('MAPPED') })
					.get('/', 'ok')
			)

			expect(app['~staticResponse'] ?? {}).not.toHaveProperty('/')
		})

		it('bail per route for plugin mapResponse, keeping siblings native', async () => {
			const plugin = new Elysia()
				.mapResponse(() => new Response('MAPPED'))
				.get('/in-plugin', 'ok')

			const app = build(new Elysia().use(plugin).get('/', 'ok'))

			expect(app['~staticResponse'] ?? {}).not.toHaveProperty(
				'/in-plugin'
			)
			// per-route granularity: the unhooked sibling stays native
			expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		})

		it('bail for a bare 0-parameter hook', async () => {
			// a scalar hook function's `.length` is its ARITY — a
			// 0-parameter beforeHandle must still disqualify the route
			// (it can throw or carry side effects the native path skips)
			let called = 0
			const app = build(
				new Elysia().get('/', 'ok', {
					beforeHandle: () => {
						called++
					}
				})
			)

			expect(app['~staticResponse'] ?? {}).not.toHaveProperty('/')

			await app.handle(new Request('http://localhost/'))
			expect(called).toBe(1)
		})

		it('bail for route-local afterResponse and trace', async () => {
			// these live on the route tuple, invisible to the adapter's
			// app-level chain check — native dispatch would silently skip
			// them (no JS handler runs on a native hit)
			const afterResponse = build(
				new Elysia().get('/', 'ok', {
					afterResponse: () => {}
				})
			)
			expect(afterResponse['~staticResponse'] ?? {}).not.toHaveProperty(
				'/'
			)

			const trace = build(
				new Elysia().get('/', 'ok', {
					trace: () => {}
				})
			)
			expect(trace['~staticResponse'] ?? {}).not.toHaveProperty('/')
		})

		it('bail when the route carries a request schema', async () => {
			// the compiled handler 422s per request — a precomputed 200
			// would silently skip validation under native dispatch
			const app = build(
				new Elysia().get('/', 'ok', {
					query: t.Object({ id: t.String() })
				})
			)

			expect(app['~staticResponse'] ?? {}).not.toHaveProperty('/')

			expect(
				(await app.handle(new Request('http://localhost/'))).status
			).toBe(422)
			expect(
				(await app.handle(new Request('http://localhost/?id=1')))
					.status
			).toBe(200)
		})
	})
})
