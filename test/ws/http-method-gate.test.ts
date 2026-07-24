import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

// WebSocket upgrades require GET; other methods continue through HTTP routing.
// The dynamic route is required to exercise WebSocket trie lookup.

describe('WebSocket upgrade method routing', () => {
	const build = () =>
		new Elysia()
			.use(websocket()).ws('/chat/:room', { message() {} })
			.get('/api/data', () => 'get')
			.post('/api/data', () => 'post')

	it('routes a plain GET to its HTTP handler', async () => {
		const res = await build().handle(req('/api/data'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('get')
	})

	it('routes plain POST requests to the HTTP handler', async () => {
		const res = await build().handle(req('/api/data', { method: 'POST' }))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('post')
	})

	it('returns 404 for an unknown GET path', async () => {
		const res = await build().handle(req('/nope'))
		expect(res.status).toBe(404)
	})

	it('treats POST with an upgrade header as HTTP and returns 404', async () => {
		const res = await build().handle(
			req('/chat/lobby', {
				method: 'POST',
				headers: { upgrade: 'websocket' }
			})
		)
		expect(res.status).toBe(404)
	})

	it('keeps HTTP routes reachable beside dynamic WebSocket routes', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/socket/:id', { message() {} })
			.post('/submit', () => 'ok')

		const res = await app.handle(req('/submit', { method: 'POST' }))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
	})

	// Ported from sennen (commit 3600912b, N+3c) per
	// design/sennen-salvage/002-salvage-rejected-sennen.md Step 2b: a static
	// WS route only fires on an actual upgrade request (GET + `upgrade:
	// websocket`); a plain GET with no upgrade header follows normal HTTP
	// method-map routing (dynamic route, then all-method route).
	it('does not let a static WebSocket route shadow dynamic HTTP', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/thing', { message() {} })
			.get('/:id', ({ params }) => `get:${params.id}`)

		await expect(
			app.handle(req('/thing')).then((response) => response.text())
		).resolves.toBe('get:thing')
	})

	it('does not let a static WebSocket route shadow an all-method route', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/thing', { message() {} })
			.all('/thing', () => 'all')

		await expect(
			app.handle(req('/thing')).then((response) => response.text())
		).resolves.toBe('all')
	})
})
