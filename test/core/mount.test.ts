import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('Mount', () => {
	it('preserve request URL', async () => {
		const plugin = new Elysia().get('/', ({ request }) => request.url)

		const app = new Elysia().mount('/mount', plugin.handle)

		expect(
			await app
				.handle(new Request('http://elysiajs.com/mount/'))
				.then((x) => x.text())
		).toBe('http://elysiajs.com/')
	})

	it('preserve request URL with query', async () => {
		const plugin = new Elysia().get('/', ({ request }) => request.url)

		const app = new Elysia().mount('/mount', plugin.handle)

		expect(
			await app
				.handle(new Request('http://elysiajs.com/mount/?a=1'))
				.then((x) => x.text())
		).toBe('http://elysiajs.com/?a=1')
	})

	it('preserve body', async () => {
		const handler = async (req: Request) => {
			return new Response(await req.text())
		}

		const app = new Elysia()
			.mount('/mount', (req) => handler(req))
			.post('/not-mount', ({ body }) => body)

		const options = {
			method: 'POST',
			headers: {
				'content-type': 'text/plain'
			},
			body: 'sucrose'
		}

		const res = await Promise.all([
			app
				.handle(new Request('http://elysiajs.com/mount', options))
				.then((x) => x.text()),
			app
				.handle(new Request('http://elysiajs.com/not-mount', options))
				.then((x) => x.text())
		])

		expect(res).toEqual(['sucrose', 'sucrose'])
	})

	it('remove wildcard path', async () => {
		const app = new Elysia().mount('/v1/*', (request) => {
			return Response.json({
				path: request.url
			})
		})

		const response = await app
			.handle(new Request('http://localhost/v1/hello'))
			.then((x) => x.json())

		expect(response).toEqual({
			path: 'http://localhost/hello'
		})
	})

	it('preserve method', async () => {
		const app = new Elysia().mount((request) => {
			return Response.json({
				method: request.method,
				path: request.url
			})
		})

		const response = await app
			.handle(
				new Request('http://localhost/v1/hello', {
					method: 'PUT'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			method: 'PUT',
			path: 'http://localhost/v1/hello'
		})
	})

	// https://github.com/elysiajs/elysia/issues/1070
	it('preserve method with prefix', async () => {
		const app = new Elysia().mount('/v1/*', (request) => {
			return Response.json({
				method: request.method,
				path: request.url
			})
		})

		const response = await app
			.handle(
				new Request('http://localhost/v1/hello', {
					method: 'PUT'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			method: 'PUT',
			path: 'http://localhost/hello'
		})
	})

	it('preserve headers', async () => {
		const app = new Elysia().mount((request) => {
			return Response.json(request.headers.toJSON())
		})

		const response = await app
			.handle(
				new Request('http://localhost/v1/hello', {
					method: 'PUT',
					headers: {
						'x-test': 'test'
					}
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			'x-test': 'test'
		})
	})

	it('without prefix - strips mount path', async () => {
		const app = new Elysia().mount('/sdk/problems-domain', (request) => {
			return Response.json({ path: new URL(request.url).pathname })
		})

		const response = await app
			.handle(
				new Request('http://localhost/sdk/problems-domain/problems')
			)
			.then((x) => x.json() as Promise<{ path: string }>)

		expect(response.path).toBe('/problems')
	})

	it('with prefix - should strip both prefix and mount path', async () => {
		const sdkApp = new Elysia({ prefix: '/sdk' }).mount(
			'/problems-domain',
			(request) => {
				return Response.json({ path: new URL(request.url).pathname })
			}
		)

		const app = new Elysia().use(sdkApp)

		const response = await app
			.handle(
				new Request('http://localhost/sdk/problems-domain/problems')
			)
			.then((x) => x.json() as Promise<{ path: string }>)

		expect(response.path).toBe('/problems')
	})

	it('handle body in aot: false', async () => {
		const app = new Elysia({ aot: false }).mount('/api', async (request) =>
			Response.json(await request.json())
		)

		const response = await app
			.handle(
				new Request('http://localhost/api', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({ message: 'hello world' })
				})
			)

			.then((x) => x.json())

		expect(response).toEqual({
			message: 'hello world'
		})
	})

	// https://github.com/elysiajs/elysia/issues/1682
	// Mount should not be overridden by less specific wildcard routes
	describe('mount with wildcard routes (issue #1682)', () => {
		it('should prefer mounted route over root wildcard', async () => {
			const backend = new Elysia().get('/test', () => 'mounted test')

			const app = new Elysia()
				.mount('/api', backend)
				.get('/*', () => 'static file')

			const response = await app
				.handle(new Request('http://localhost/api/test'))
				.then((x) => x.text())

			expect(response).toBe('mounted test')
		})

		it('should use wildcard for non-mounted paths', async () => {
			const backend = new Elysia().get('/test', () => 'mounted test')

			const app = new Elysia()
				.mount('/api', backend)
				.get('/*', () => 'static file')

			const response = await app
				.handle(new Request('http://localhost/other/path'))
				.then((x) => x.text())

			expect(response).toBe('static file')
		})

		it('should handle wildcard registered before mount', async () => {
			const backend = new Elysia().get('/test', () => 'mounted test')

			const app = new Elysia()
				.get('/*', () => 'static file')
				.mount('/api', backend)

			const response = await app
				.handle(new Request('http://localhost/api/test'))
				.then((x) => x.text())

			expect(response).toBe('mounted test')
		})

		it('should handle multiple mounts with wildcard', async () => {
			const apiBackend = new Elysia().get('/users', () => 'api users')
			const v2Backend = new Elysia().get('/users', () => 'v2 users')

			const app = new Elysia()
				.mount('/api', apiBackend)
				.mount('/v2', v2Backend)
				.get('/*', () => 'static')

			const results = await Promise.all([
				app
					.handle(new Request('http://localhost/api/users'))
					.then((x) => x.text()),
				app
					.handle(new Request('http://localhost/v2/users'))
					.then((x) => x.text()),
				app
					.handle(new Request('http://localhost/other'))
					.then((x) => x.text())
			])

			expect(results).toEqual(['api users', 'v2 users', 'static'])
		})

		it('should prefer method-specific route when equally specific', async () => {
			const app = new Elysia()
				.all('/api/*', () => 'all api/*')
				.get('/api/*', () => 'get api/*')

			const getResponse = await app
				.handle(new Request('http://localhost/api/test'))
				.then((x) => x.text())

			const postResponse = await app
				.handle(
					new Request('http://localhost/api/test', { method: 'POST' })
				)
				.then((x) => x.text())

			expect(getResponse).toBe('get api/*')
			expect(postResponse).toBe('all api/*')
		})

		it('should handle POST mount with POST wildcard', async () => {
			const backend = new Elysia().post('/data', () => 'mounted POST')

			const app = new Elysia()
				.mount('/api', backend)
				.post('/*', () => 'post wildcard')

			const mountedResponse = await app
				.handle(
					new Request('http://localhost/api/data', { method: 'POST' })
				)
				.then((x) => x.text())

			const wildcardResponse = await app
				.handle(
					new Request('http://localhost/other', { method: 'POST' })
				)
				.then((x) => x.text())

			expect(mountedResponse).toBe('mounted POST')
			expect(wildcardResponse).toBe('post wildcard')
		})

		it('should handle multiple HTTP methods in mount', async () => {
			const backend = new Elysia()
				.get('/data', () => 'GET data')
				.post('/data', () => 'POST data')
				.put('/data', () => 'PUT data')

			const app = new Elysia()
				.mount('/api', backend)
				.get('/*', () => 'GET wildcard')
				.post('/*', () => 'POST wildcard')

			const results = await Promise.all([
				app
					.handle(new Request('http://localhost/api/data'))
					.then((x) => x.text()),
				app
					.handle(
						new Request('http://localhost/api/data', {
							method: 'POST'
						})
					)
					.then((x) => x.text()),
				app
					.handle(
						new Request('http://localhost/api/data', {
							method: 'PUT'
						})
					)
					.then((x) => x.text()),
				app
					.handle(new Request('http://localhost/other'))
					.then((x) => x.text())
			])

			expect(results).toEqual([
				'GET data',
				'POST data',
				'PUT data',
				'GET wildcard'
			])
		})
	})
})
