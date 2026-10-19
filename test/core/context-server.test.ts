import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('context.server', () => {
	it('exposes the listening server inside a route handler', async () => {
		let captured: unknown = 'not-set'

		const app = new Elysia().get('/ping', ({ server }) => {
			captured = server
			return 'pong'
		})

		const server = app.listen(0)

		try {
			await new Promise((r) => setTimeout(r, 20))

			const port = (app.server as any)?.port
			expect(port).toBeGreaterThan(0)

			const res = await fetch(`http://localhost:${port}/ping`)
			await res.text()

			expect(captured).not.toBeNull()
			expect(captured).not.toBeUndefined()
			expect(typeof (captured as any).port).toBe('number')
		} finally {
			server.stop(true)
		}
	})

	it('is null when a request is handled without a server', async () => {
		let captured: unknown = 'not-set'

		const app = new Elysia().get('/ping', ({ server }) => {
			captured = server
			return 'pong'
		})

		const res = await app.handle(new Request('http://localhost/ping'))
		expect(res.status).toBe(200)
		expect(captured).toBeNull()
	})
})
