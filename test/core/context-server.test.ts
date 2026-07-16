import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

// Regression for: createFetchHandler returned a single-arg (request) function,
// so the server arg passed by the Bun adapter was silently ignored and
// context.server was always undefined in handlers.
describe('context.server', () => {
	it('context.server is defined inside handler when listening on a real socket', async () => {
		let captured: unknown = 'not-set'

		const app = new Elysia().get('/ping', ({ server }) => {
			captured = server
			return 'pong'
		})

		const server = app.listen(0)

		try {
			// Let the microtask queue settle so Bun.serve is called
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

	it('context.server is null (not throwing) when using app.handle()', async () => {
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
