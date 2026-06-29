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
		await expect(app['~staticResponse']['/'].GET.text()).resolves.toEqual(
			'Static Content'
		)
	})

	it('handle plugin', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = build(new Elysia().use(plugin).get('/', 'Static Content'))

		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		await expect(app['~staticResponse']['/'].GET.text()).resolves.toEqual(
			'Static Content'
		)

		expect(app['~staticResponse']['/plugin'].GET).toBeInstanceOf(Response)
		await expect(
			app['~staticResponse']['/plugin'].GET.text()
		).resolves.toEqual('Plugin')
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
		await expect(app['~staticResponse']['/'].GET.text()).resolves.toEqual(
			'Static Content'
		)

		expect(app['~staticResponse']['/plugin'].GET).toBeInstanceOf(Response)
		expect(
			app['~staticResponse']['/plugin'].GET.headers.get('server')
		).toBe('Elysia')
		await expect(
			app['~staticResponse']['/plugin'].GET.text()
		).resolves.toEqual('Plugin')
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

		const app = build(new Elysia().use(plugin).get('/', 'Static Content'))

		// Loose entries share the canonical Response object (no clone), so
		// clone before reading — consuming the body here would empty the
		// object Bun serves by reference.
		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		await expect(
			app['~staticResponse']['/'].GET.clone().text()
		).resolves.toEqual('Static Content')

		expect(app['~staticResponse'][''].GET).toBeInstanceOf(Response)
		await expect(
			app['~staticResponse'][''].GET.clone().text()
		).resolves.toEqual('Static Content')

		expect(app['~staticResponse']['/plugin'].GET).toBeInstanceOf(Response)
		await expect(
			app['~staticResponse']['/plugin'].GET.clone().text()
		).resolves.toEqual('Plugin')

		expect(app['~staticResponse']['/plugin/'].GET).toBeInstanceOf(Response)
		await expect(
			app['~staticResponse']['/plugin/'].GET.clone().text()
		).resolves.toEqual('Plugin')

		const strict = build(
			new Elysia({ strictPath: true })
				.use(plugin)
				.get('/', 'Static Content')
		)

		expect(strict['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		await expect(
			strict['~staticResponse']['/'].GET.text()
		).resolves.toEqual('Static Content')
		expect(strict['~staticResponse']).not.toHaveProperty('')

		expect(strict['~staticResponse']['/plugin'].GET).toBeInstanceOf(
			Response
		)
		await expect(
			strict['~staticResponse']['/plugin'].GET.text()
		).resolves.toEqual('Plugin')
		expect(strict['~staticResponse']).not.toHaveProperty('/plugin/')
	})

	describe('eligibility', () => {
		it('static app-level mapResponse', async () => {
			const app = build(
				new Elysia()
					.mapResponse(() => new Response('MAPPED'))
					.get('/', 'ok')
			)

			expect(app['~staticResponse'] ?? {}).toHaveProperty('/')

			// the JS path is the source of truth for the mapped body
			await expect(
				app
					.handle(new Request('http://localhost/'))
					.then((x) => x.text())
			).resolves.toBe('MAPPED')
		})

		it('static for route-local mapResponse (scalar and array)', async () => {
			const scalar = build(
				new Elysia().get(
					'/',
					{
						mapResponse: () => new Response('MAPPED')
					},
					'ok'
				)
			)
			expect(scalar['~staticResponse'] ?? {}).toHaveProperty('/')

			const array = build(
				new Elysia().get(
					'/',
					{
						mapResponse: [() => new Response('MAPPED')]
					},
					'ok'
				)
			)
			expect(array['~staticResponse'] ?? {}).toHaveProperty('/')
		})

		it('static for guard mapResponse', async () => {
			const app = build(
				new Elysia()
					.guard({ mapResponse: () => new Response('MAPPED') })
					.get('/', 'ok')
			)

			expect(app['~staticResponse'] ?? {}).toHaveProperty('/')
		})

		it('static per route for plugin mapResponse, keeping siblings native', async () => {
			const plugin = new Elysia()
				.mapResponse(() => new Response('MAPPED'))
				.get('/in-plugin', 'ok')

			const app = build(new Elysia().use(plugin).get('/', 'ok'))

			expect(app['~staticResponse'] ?? {}).toHaveProperty(
				'/in-plugin'
			)
			// per-route granularity: the unhooked sibling stays native
			expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		})

		it('static for a bare 0-parameter hook', async () => {
			let called = 0
			const app = build(
				new Elysia().get(
					'/',
					{
						beforeHandle: () => {
							called++
						}
					},
					'ok'
				)
			)

			expect(app['~staticResponse'] ?? {}).toHaveProperty('/')

			await app.handle(new Request('http://localhost/'))
			expect(called).toBe(1)
		})

		it('static for route-local afterResponse and trace', async () => {
			const afterResponse = build(
				new Elysia().get(
					'/',
					{
						afterResponse: () => {}
					},
					'ok'
				)
			)

			expect(afterResponse['~staticResponse'] ?? {}).toHaveProperty(
				'/'
			)

			const trace = build(
				new Elysia().get(
					'/',
					{
						trace: () => {}
					},
					'ok'
				)
			)
			expect(trace['~staticResponse'] ?? {}).toHaveProperty('/')
		})

		it('static when the route carries a request schema', async () => {
			const app = build(
				new Elysia().get(
					'/',
					{
						query: t.Object({ id: t.String() })
					},
					'ok'
				)
			)

			expect(app['~staticResponse'] ?? {}).toHaveProperty('/')

			expect(
				(await app.handle(new Request('http://localhost/'))).status
			).toBe(422)
			expect(
				(await app.handle(new Request('http://localhost/?id=1'))).status
			).toBe(200)
		})
	})
})
