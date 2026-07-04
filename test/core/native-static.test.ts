// @ts-nocheck
import { Elysia, t } from '../../src'
import { collectStaticRoutes } from '../../src/adapter/bun'
import { describe, expect, it } from 'bun:test'

const collect = (app: any) => collectStaticRoutes(app as any)?.[0]
const route = (app: any, path: string, method = 'GET') =>
	collect(app)?.[path]?.[method]

const expectResponseText = async (response: Response | undefined, text: string) => {
	expect(response).toBeInstanceOf(Response)
	await expect(response!.clone().text()).resolves.toEqual(text)
}

describe('Native Static Response', () => {
	it('collects bare static routes for the Bun adapter without retaining a base map', async () => {
		const app = new Elysia().get('/', 'Static Content')
		void app.fetch

		expect(app['~staticResponse']).toBeUndefined()
		await expectResponseText(route(app, '/'), 'Static Content')
	})

	it('handles plugin routes', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')
		const app = new Elysia().use(plugin).get('/', 'Static Content')

		await expectResponseText(route(app, '/'), 'Static Content')
		await expectResponseText(route(app, '/plugin'), 'Plugin')
	})

	it('handles default headers', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')
		const app = new Elysia()
			.headers({ server: 'Elysia' })
			.use(plugin)
			.get('/', 'Static Content')

		const root = route(app, '/')
		expect(root?.headers.get('server')).toBe('Elysia')
		await expectResponseText(root, 'Static Content')

		const child = route(app, '/plugin')
		expect(child?.headers.get('server')).toBe('Elysia')
		await expectResponseText(child, 'Plugin')
	})

	it('turns off by config', () => {
		const app = new Elysia({ nativeStaticResponse: false }).get(
			'/',
			'Static Content'
		)

		expect(collect(app)).toBeUndefined()
	})

	it('handles loose paths', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')
		const app = new Elysia().use(plugin).get('/', 'Static Content')

		await expectResponseText(route(app, '/'), 'Static Content')
		await expectResponseText(route(app, ''), 'Static Content')
		await expectResponseText(route(app, '/plugin'), 'Plugin')
		await expectResponseText(route(app, '/plugin/'), 'Plugin')

		const strict = new Elysia({ strictPath: true })
			.use(plugin)
			.get('/', 'Static Content')
		const strictRoutes = collect(strict)!

		await expectResponseText(strictRoutes['/']?.GET, 'Static Content')
		expect(strictRoutes).not.toHaveProperty('')
		await expectResponseText(strictRoutes['/plugin']?.GET, 'Plugin')
		expect(strictRoutes).not.toHaveProperty('/plugin/')
	})

	describe('eligibility', () => {
		it('collects routes with app-level mapResponse', async () => {
			const app = new Elysia()
				.mapResponse(() => new Response('MAPPED'))
				.get('/', 'ok')

			await expectResponseText(route(app, '/'), 'MAPPED')

			await expect(
				app
					.handle(new Request('http://localhost/'))
					.then((x) => x.text())
			).resolves.toBe('MAPPED')
		})

		it('collects routes with route-local mapResponse (scalar and array)', async () => {
			const scalar = new Elysia().get(
				'/',
				{
					mapResponse: () => new Response('MAPPED')
				},
				'ok'
			)
			await expectResponseText(route(scalar, '/'), 'MAPPED')

			const array = new Elysia().get(
				'/',
				{
					mapResponse: [() => new Response('MAPPED')]
				},
				'ok'
			)
			await expectResponseText(route(array, '/'), 'MAPPED')
		})

		it('collects routes with guard mapResponse', async () => {
			const app = new Elysia()
				.guard({ mapResponse: () => new Response('MAPPED') })
				.get('/', 'ok')

			await expectResponseText(route(app, '/'), 'MAPPED')
		})

		it('collects plugin mapResponse per route, keeping siblings native', async () => {
			const plugin = new Elysia()
				.mapResponse(() => new Response('MAPPED'))
				.get('/in-plugin', 'ok')

			const app = new Elysia().use(plugin).get('/', 'ok')

			await expectResponseText(route(app, '/in-plugin'), 'MAPPED')
			await expectResponseText(route(app, '/'), 'ok')
		})

		it('bails for a bare 0-parameter hook', async () => {
			let called = 0
			const app = new Elysia().get(
				'/',
				{
					beforeHandle: () => {
						called++
					}
				},
				'ok'
			)

			expect(route(app, '/')).toBeUndefined()

			await app.handle(new Request('http://localhost/'))
			expect(called).toBe(1)
		})

		it('collects route-local afterResponse and trace', async () => {
			const afterResponse = new Elysia().get(
				'/',
				{
					afterResponse: () => {}
				},
				'ok'
			)
			await expectResponseText(route(afterResponse, '/'), 'ok')

			const trace = new Elysia().get(
				'/',
				{
					trace: () => {}
				},
				'ok'
			)
			await expectResponseText(route(trace, '/'), 'ok')
		})

		it('bails when the route carries a request schema', async () => {
			const app = new Elysia().get(
				'/',
				{
					query: t.Object({ id: t.String() })
				},
				'ok'
			)

			expect(route(app, '/')).toBeUndefined()
			expect(
				(await app.handle(new Request('http://localhost/'))).status
			).toBe(422)
			expect(
				(await app.handle(new Request('http://localhost/?id=1'))).status
			).toBe(200)
		})

		it('bails for an app-level .request() hook (always-global)', async () => {
			let called = 0
			const app = new Elysia()
				.request(() => {
					called++
				})
				.get('/', 'ok')

			expect(route(app, '/')).toBeUndefined()

			await app.handle(new Request('http://localhost/'))
			expect(called).toBe(1)
		})

		it('bails for a .wrap() higher-order fetch handler', async () => {
			let wrapped = 0
			const app = new Elysia()
				.wrap((fetch) => (request) => {
					wrapped++
					return fetch(request)
				})
				.get('/', 'ok')

			expect(route(app, '/')).toBeUndefined()

			await app.handle(new Request('http://localhost/'))
			expect(wrapped).toBe(1)
		})

		it('bails for an app-level .trace() handler', () => {
			const app = new Elysia().trace(() => {}).get('/', 'ok')

			expect(route(app, '/')).toBeUndefined()
		})

		it('collects a genuinely bare static route with an error hook', async () => {
			const app = new Elysia().error({}).get('/', 'ok')

			await expectResponseText(route(app, '/'), 'ok')
		})
	})
})
