import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

// FIX (fetch-universal-2): when an app co-hosts a *dynamic* WS route, the fetch
// hot path used to run `router.find('WS', path)` — a full trie traversal — on
// EVERY incoming request, including plain HTTP POST/PUT/… that can never be a
// WebSocket upgrade. A WS upgrade is always an HTTP GET (RFC 6455 §4.1), so the
// WS probe (map lookup + trie walk) is now gated on `request.method === 'GET'`.
//
// These pin that HTTP routing is unchanged for GET/POST and that a non-GET
// request with an `upgrade` header (malformed per spec) is NOT treated as a WS
// upgrade — it falls through to normal HTTP routing.

describe('ws http method gate', () => {
	const build = () =>
		new Elysia()
			.ws('/chat/:room', { message() {} }) // dynamic → uses the WS trie
			.get('/api/data', () => 'get')
			.post('/api/data', () => 'post')

	it('routes a plain GET to its HTTP handler', async () => {
		const res = await build().handle(req('/api/data'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('get')
	})

	it('routes a plain POST to its HTTP handler (skips the WS probe)', async () => {
		const res = await build().handle(
			req('/api/data', { method: 'POST' })
		)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('post')
	})

	it('returns 404 for an unknown GET path', async () => {
		const res = await build().handle(req('/nope'))
		expect(res.status).toBe(404)
	})

	// A POST carrying an `upgrade: websocket` header is malformed (a WS upgrade
	// must be a GET). It must NOT reach the WS handler — it falls through to
	// HTTP routing, which has no POST route at the WS path → 404.
	it('does not upgrade a POST with an upgrade header (404, not WS)', async () => {
		const res = await build().handle(
			req('/chat/lobby', {
				method: 'POST',
				headers: { upgrade: 'websocket' }
			})
		)
		expect(res.status).toBe(404)
	})

	// The WS route must still shadow nothing on the HTTP side: a matching HTTP
	// route at a different method is reachable even when a dynamic WS route
	// exists at a sibling path.
	it('reaches HTTP routes when a dynamic WS route co-exists', async () => {
		const app = new Elysia()
			.ws('/socket/:id', { message() {} })
			.post('/submit', () => 'ok')

		const res = await app.handle(req('/submit', { method: 'POST' }))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
	})
})
