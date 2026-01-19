import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

describe('SPA Fallback Routing - Issue #1515', () => {
	it('handles mount routes with root wildcard static response', async () => {
		const backend = new Elysia().get('/users', () => ({
			users: ['alice', 'bob']
		}))

		const staticHtml = new Response('<html><body>SPA</body></html>', {
			headers: { 'content-type': 'text/html' }
		})

		const app = new Elysia()
			.mount('/api', backend)
			.get('/*', staticHtml)
			.listen(0)

		const apiResponse = await app
			.handle(new Request(`http://localhost/api/users`))
			.then((r) => r.json())

		const spaResponse = await app
			.handle(new Request(`http://localhost/other`))
			.then((r) => r.text())

		expect(apiResponse).toEqual({ users: ['alice', 'bob'] })
		expect(spaResponse).toContain('SPA')

		await app.server!.stop()
	})

	it('handles multiple mounts with root wildcard', async () => {
		const backend = new Elysia().get('/users', () => ({ users: ['test'] }))

		const staticHtml = new Response('<html>SPA</html>', {
			headers: { 'content-type': 'text/html' }
		})

		const app = new Elysia()
			.mount('/api', backend)
			.mount('/v2', backend)
			.get('/*', staticHtml)
			.listen(0)

		const api1 = await app
			.handle(new Request('http://localhost/api/users'))
			.then((r) => r.json())

		const api2 = await app
			.handle(new Request('http://localhost/v2/users'))
			.then((r) => r.json())

		const spa = await app
			.handle(new Request('http://localhost/other'))
			.then((r) => r.text())

		expect(api1).toEqual({ users: ['test'] })
		expect(api2).toEqual({ users: ['test'] })
		expect(spa).toContain('SPA')

		await app.server!.stop()
	})

	it('respects order - wildcard registered before mount', async () => {
		const backend = new Elysia().get('/users', () => ({ data: 'api' }))

		const staticHtml = new Response('<html>SPA</html>', {
			headers: { 'content-type': 'text/html' }
		})

		const app = new Elysia()
			.get('/*', staticHtml)
			.mount('/api', backend)
			.listen(0)

		const api = await app
			.handle(new Request('http://localhost/api/users'))
			.then((r) => r.json())

		const spa = await app
			.handle(new Request('http://localhost/other'))
			.then((r) => r.text())

		expect(api).toEqual({ data: 'api' })
		expect(spa).toContain('SPA')

		await app.server!.stop()
	})

	it('handles POST requests to mounted routes', async () => {
		const backend = new Elysia().post('/auth', () => ({ token: 'xyz' }))

		const staticHtml = new Response('<html>SPA</html>', {
			headers: { 'content-type': 'text/html' }
		})

		const app = new Elysia()
			.mount('/api', backend)
			.get('/*', staticHtml)
			.listen(0)

		const response = await app
			.handle(new Request('http://localhost/api/auth', { method: 'POST' }))
			.then((r) => r.json())

		expect(response).toEqual({ token: 'xyz' })

		await app.server!.stop()
	})

	it('allows specific wildcard paths with mounts', async () => {
		const backend = new Elysia().get('/users', () => ({ data: 'api' }))

		const publicHtml = new Response('<html>Public</html>', {
			headers: { 'content-type': 'text/html' }
		})

		const app = new Elysia()
			.mount('/api', backend)
			.get('/public/*', publicHtml)
			.listen(0)

		const api = await app
			.handle(new Request('http://localhost/api/users'))
			.then((r) => r.json())

		const publicAsset = await app
			.handle(new Request('http://localhost/public/asset.js'))
			.then((r) => r.text())

		expect(api).toEqual({ data: 'api' })
		expect(publicAsset).toContain('Public')

		await app.server!.stop()
	})

	it('preserves normal wildcard behavior without mounts', async () => {
		const staticHtml = new Response('<html>SPA</html>', {
			headers: { 'content-type': 'text/html' }
		})

		const app = new Elysia()
			.get('/api/users', () => ({ users: ['alice'] }))
			.get('/*', staticHtml)
			.listen(0)

		const api = await app
			.handle(new Request('http://localhost/api/users'))
			.then((r) => r.json())

		const spa = await app
			.handle(new Request('http://localhost/other'))
			.then((r) => r.text())

		expect(api).toEqual({ users: ['alice'] })
		expect(spa).toContain('SPA')

		await app.server!.stop()
	})

	it('handles nested mount paths correctly', async () => {
		const backend = new Elysia().get('/status', () => ({ status: 'ok' }))

		const staticHtml = new Response('<html>SPA</html>', {
			headers: { 'content-type': 'text/html' }
		})

		const app = new Elysia()
			.mount('/api/v1', backend)
			.get('/*', staticHtml)
			.listen(0)

		const api = await app
			.handle(new Request('http://localhost/api/v1/status'))
			.then((r) => r.json())

		const spa = await app
			.handle(new Request('http://localhost/other'))
			.then((r) => r.text())

		expect(api).toEqual({ status: 'ok' })
		expect(spa).toContain('SPA')

		await app.server!.stop()
	})
})
