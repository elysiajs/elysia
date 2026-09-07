import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { autoHead } from '../../src/plugin/auto-head'

describe('autoHead plugin', () => {
	it('registers nested plugin routes as declarations', async () => {
		const plugin = new Elysia()
			.use(autoHead())
			.get('/plugin', () => 'plugin')
		const app = new Elysia().get('/root', () => 'root').use(plugin)
		await app.modules

		expect((await app.handle('/root', { method: 'HEAD' })).status).toBe(404)
		expect((await app.handle('/plugin', { method: 'HEAD' })).status).toBe(
			200
		)
		expect(
			app.history.some(
				(route) => route.method === 'HEAD' && route.path === '/plugin'
			)
		).toBeTrue()
		expect(
			app.routes.some(
				(route) => route.method === 'HEAD' && route.path === '/plugin'
			)
		).toBeTrue()
	})

	it('keeps an explicit HEAD winner regardless of plugin order', async () => {
		const app = new Elysia()
			.head('/x', ({ set }) => {
				set.headers['x-source'] = 'explicit'
			})
			.get('/x', () => 'derived')
			.use(autoHead())
		await app.modules

		const response = await app.handle('/x', { method: 'HEAD' })
		expect(response.headers.get('x-source')).toBe('explicit')
		await expect(response.text()).resolves.toBe('')
	})

	it('registers HEAD routes when applied after GET routes', async () => {
		const app = new Elysia().get('/x', () => 'get')
		app.use(autoHead())
		await app.modules

		expect((await app.handle('/x', { method: 'HEAD' })).status).toBe(200)
	})

	it('throws when auto-head is applied after the first request', async () => {
		const app = new Elysia().get('/x', () => 'get')
		expect((await app.handle('/x', { method: 'HEAD' })).status).toBe(404)

		expect(() => app.use(autoHead())).toThrow('after the app was sealed')
	})

	it('preserves GET lifecycle and mapped headers without replaying hooks', async () => {
		let requests = 0
		let beforeHandle = 0
		const app = new Elysia()
			.request(() => {
				requests++
			})
			.use(autoHead())
			.get(
				'/x',
				{
					beforeHandle() {
						beforeHandle++
					}
				},
				() => new Response('get', { headers: { 'x-mapped': 'yes' } })
			)
		await app.modules

		const response = await app.handle('/x', { method: 'HEAD' })

		expect(response.headers.get('x-mapped')).toBe('yes')
		await expect(response.text()).resolves.toBe('')
		expect(requests).toBe(1)
		expect(beforeHandle).toBe(1)
	})
})
