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

	it('mount without prefix - strips mount path', async () => {
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

	it('mount with prefix - should strip both prefix and mount path', async () => {
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
})
