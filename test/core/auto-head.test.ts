import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { autoHead } from '../../src/plugin/auto-head'
import { req } from '../utils'

describe('autoHead plugin', () => {
	it('registers nested plugin routes as declarations', async () => {
		const plugin = new Elysia()
			.use(autoHead())
			.get('/plugin', () => 'plugin')
		const app = new Elysia().get('/root', () => 'root').use(plugin)
		await app.modules

		expect(
			(await app.handle(req('/root', { method: 'HEAD' }))).status
		).toBe(404)
		expect(
			(await app.handle(req('/plugin', { method: 'HEAD' }))).status
		).toBe(200)
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

		const response = await app.handle(req('/x', { method: 'HEAD' }))
		expect(response.headers.get('x-source')).toBe('explicit')
		expect(await response.text()).toBe('')
	})

	it('registers HEAD routes when applied late in authoring order (after routes)', async () => {
		// Original intent: auto-head must register HEAD routes even when the plugin
		// is applied AFTER other routes are declared. Under Q4 the vehicle is
		// authoring order (all edits before the first request), not
		// serve-then-mutate: declare the GET first, then apply auto-head, then serve.
		const app = new Elysia().get('/x', () => 'get')
		app.use(autoHead())
		await app.modules

		expect((await app.handle(req('/x', { method: 'HEAD' }))).status).toBe(
			200
		)
	})

	it('applying auto-head AFTER the first request throws (Q4 sealed)', async () => {
		// The retired "register after the router was already built" behavior
		// (serve, then `.use(autoHead())`, then serve again) silently rebuilt. Under
		// B6 the first request seals the app, so applying the plugin afterward is an
		// immutable-instance violation and must throw — the plugin cannot be smuggled
		// in past the seal to synthesize HEAD routes.
		const app = new Elysia().get('/x', () => 'get')
		expect((await app.handle(req('/x', { method: 'HEAD' }))).status).toBe(
			404
		)

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

		const response = await app.handle(req('/x', { method: 'HEAD' }))

		expect(response.headers.get('x-mapped')).toBe('yes')
		expect(await response.text()).toBe('')
		expect(requests).toBe(1)
		expect(beforeHandle).toBe(1)
	})
})
