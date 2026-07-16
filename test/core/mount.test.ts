import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('Mount', () => {
	it('preserve request URL', async () => {
		const plugin = new Elysia().get('/', ({ request }) => request.url)

		const app = new Elysia().mount('/mount', plugin.handle)

		await expect(
			app
				.handle(new Request('http://elysiajs.com/mount/'))
				.then((x) => x.text())
		).resolves.toBe('http://elysiajs.com/')
	})

	it('preserve request URL with query', async () => {
		const plugin = new Elysia().get('/', ({ request }) => request.url)

		const app = new Elysia().mount('/mount', plugin.handle)

		await expect(
			app
				.handle(new Request('http://elysiajs.com/mount/?a=1'))
				.then((x) => x.text())
		).resolves.toBe('http://elysiajs.com/?a=1')
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

	it('handle body', async () => {
		const app = new Elysia().mount('/api', async (request) =>
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

	it('preserve set-cookie headers from Response with CORS', async () => {
		const handler = async () => {
			const headers = new Headers()
			headers.set('location', '/redirect')
			headers.append('set-cookie', 'session=abc123; Path=/; HttpOnly')
			headers.append('set-cookie', 'token=xyz789; Path=/; Secure')

			return new Response('OK', {
				status: 302,
				headers
			})
		}

		const app = new Elysia()
			.use((app) =>
				app.beforeHandle(({ set }) => {
					set.headers['access-control-allow-origin'] = '*'
				})
			)
			.mount('/auth', handler)

		const response = await app.handle(
			new Request('http://localhost/auth/login', {
				method: 'POST'
			})
		)

		const cookies = response.headers.getSetCookie()
		expect(cookies).toHaveLength(2)
		expect(cookies).toContain('session=abc123; Path=/; HttpOnly')
		expect(cookies).toContain('token=xyz789; Path=/; Secure')
		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe('/redirect')
	})

	// The sub-path strip length must come from the FINAL registered route path
	// (post prefix-join at `.use()`/build time), not the string known when
	// `.mount()` runs. Freezing it at registration corrupts the forwarded path
	// whenever the mounting instance is later prefixed, when the mount path
	// lacks a leading slash, or when it contains non-ASCII (encoded) chars.
	const forwarded = (request: Request) =>
		Response.json({ path: new URL(request.url).pathname })

	it('strips the final path when the mounting instance is later prefixed', async () => {
		// plugin mounts, THEN gets `.use()`d under a prefixed parent — the
		// route path grows by `/parent`, so a registration-time strip length
		// under-strips (previously forwarded `/arent/m/foo`)
		const plugin = new Elysia().mount('/m', forwarded)
		const app = new Elysia({ prefix: '/parent' }).use(plugin)

		const path = await app
			.handle(new Request('http://localhost/parent/m/foo'))
			.then((x) => x.json() as Promise<{ path: string }>)
			.then((x) => x.path)

		expect(path).toBe('/foo')
	})

	it('strips a mount path that lacks a leading slash', async () => {
		const app = new Elysia().mount('m', forwarded)

		const path = await app
			.handle(new Request('http://localhost/m/foo'))
			.then((x) => x.json() as Promise<{ path: string }>)
			.then((x) => x.path)

		expect(path).toBe('/foo')
	})

	it('strips a non-ASCII mount path by its encoded length', async () => {
		// `c.path` at runtime is percent-encoded; the encoded mount root is
		// longer than the raw string, so a raw-length strip over/under-shoots
		// It previously dropped the leading UTF-8 escape and forwarded a malformed path.
		const app = new Elysia().mount('/café', forwarded)

		const path = await app
			.handle(new Request('http://localhost/caf%C3%A9/x'))
			.then((x) => x.json() as Promise<{ path: string }>)
			.then((x) => x.path)

		expect(path).toBe('/x')
	})

	it('keeps a non-ASCII mount root encoded-length-correct under a later prefix', async () => {
		const plugin = new Elysia().mount('/café', forwarded)
		const app = new Elysia({ prefix: '/parent' }).use(plugin)

		const path = await app
			.handle(new Request('http://localhost/parent/caf%C3%A9/x'))
			.then((x) => x.json() as Promise<{ path: string }>)
			.then((x) => x.path)

		expect(path).toBe('/x')
	})

	it('forwards the sub-path with its original encoding preserved', async () => {
		// the remainder must NOT be decoded — an encoded `%2F` is semantically
		// distinct from a literal `/` to the mounted sub-app's router
		const app = new Elysia().mount('/m', forwarded)

		const path = await app
			.handle(new Request('http://localhost/m/a%2Fb'))
			.then((x) => x.json() as Promise<{ path: string }>)
			.then((x) => x.path)

		expect(path).toBe('/a%2Fb')
	})

	it('strips the prefix from a root mount used under a prefixed parent', async () => {
		const plugin = new Elysia().mount('/', forwarded)
		const app = new Elysia({ prefix: '/api' }).use(plugin)

		const path = await app
			.handle(new Request('http://localhost/api/foo'))
			.then((x) => x.json() as Promise<{ path: string }>)
			.then((x) => x.path)

		expect(path).toBe('/foo')
	})
})
