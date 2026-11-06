import { Elysia, InternalServerError, NotFound, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'

import { describe, expect, it } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { newWebsocket, wsClosed, wsMessage, wsOpen } from '../ws/utils'

describe('Handle Error', () => {
	it('handle NOT_FOUND', async () => {
		const res = await new Elysia()
			.get('/', () => {
				throw new NotFound()
			})
			.handle('/')

		await expect(res.json()).resolves.toEqual({
			type: 'not-found',
			code: 'not-found',
			title: 'Not Found',
			status: 404
		})
		expect(res.status).toBe(404)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
	})

	it('handle INTERNAL_SERVER_ERROR', async () => {
		const res = await new Elysia()
			.get('/', () => {
				throw new InternalServerError()
			})
			.handle('/')

		await expect(res.json()).resolves.toEqual({
			type: 'internal-server-error',
			code: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500
		})
		expect(res.status).toBe(500)
	})

	it('handle VALIDATION', async () => {
		const res = await new Elysia()
			.get(
				'/',
				{
					query: t.Object({
						name: t.String()
					})
				},
				() => 'Hi'
			)
			.handle('/')

		expect(res.status).toBe(422)
	})

	it('use custom error', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			.onError(({ error }) => {
				if (error instanceof NotFound)
					return new Response("I'm a teapot", {
						status: 418
					})
			})
			.handle('/not-found')

		await expect(res.text()).resolves.toBe("I'm a teapot")
		expect(res.status).toBe(418)
	})

	it('inject headers to error', async () => {
		const app = new Elysia()
			.onRequest(({ set }) => {
				set.headers['Access-Control-Allow-Origin'] = '*'
			})
			.get('/', () => {
				throw new NotFound()
			})

		const res = await app.handle('/')

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
		expect(res.status).toBe(404)
	})

	it('transform any to error', async () => {
		const app = new Elysia()
			.onError(async ({ set }) => {
				set.status = 418

				return 'aw man'
			})
			.get('/', () => {
				throw new NotFound()
			})

		const res = await app.handle('/')

		await expect(res.text()).resolves.toBe('aw man')
		expect(res.status).toBe(418)
	})

	it('handle error in group', async () => {
		const authenticate = new Elysia().group('/group', (group) =>
			group
				.get('/inner', () => {
					throw new Error('A')
				})
				.onError(() => {
					return 'handled'
				})
		)

		const app = new Elysia().use(authenticate)

		const response = await app.handle('/group/inner')

		await expect(response.text()).resolves.toEqual('handled')
		expect(response.status).toEqual(500)
	})

	it('handle error status in group', async () => {
		const authenticate = new Elysia().group('/group', (group) =>
			group
				.get('/inner', ({ set }) => {
					set.status = 418

					throw new Error('A')
				})
				.onError(() => {
					return 'handled'
				})
		)

		const app = new Elysia().use(authenticate)

		const response = await app.handle('/group/inner')

		await expect(response.text()).resolves.toEqual('handled')
		expect(response.status).toEqual(418)
	})

	it('handle thrown status()', async () => {
		const app = new Elysia().get('/', ({ status }) => {
			throw status(404, 'Not Found :(')
		})

		const response = await app.handle('/')

		await expect(response.text()).resolves.toEqual('Not Found :(')
		expect(response.status).toEqual(404)
	})

	it('handle thrown Response', async () => {
		const app = new Elysia().get('/', () => {
			throw new Response('Not Found :(', {
				status: 404,
				headers: { 'x-a': '1' }
			})
		})

		const response = await app.handle('/')

		await expect(response.text()).resolves.toEqual('Not Found :(')
		expect(response.status).toEqual(404)
		expect(response.headers.get('x-a')).toEqual('1')
	})

	it('error hook returning a value overrides a thrown Response', async () => {
		const app = new Elysia()
			.onError(() => 'handled')
			.get('/', () => {
				throw new Response('Not Found :(', {
					status: 404,
					headers: { 'x-a': '1' }
				})
			})

		const response = await app.handle('/')

		// the fallback only serves the Response once every hook declined it
		await expect(response.text()).resolves.toEqual('handled')
	})

	it('handle error code in request', async () => {
		class APIError extends Error {
			public readonly message: string
			public readonly status: number

			constructor(
				status: number,
				message: string,
				options?: ErrorOptions
			) {
				super(message, options)

				this.status = status
				this.message = message
				this.name = 'APIError'

				Object.setPrototypeOf(this, APIError.prototype)
				Error.captureStackTrace(this)
			}
		}

		const errors = new Elysia().onError(
			'global',
			APIError,
			({ error }) => error.name
		)

		const requestHandler = new Elysia()
			.onTransform(() => {
				throw new APIError(403, 'Not authorized')
			})
			.get('/', () => 'a')

		const app = new Elysia().use(errors).use(requestHandler)

		await expect(app.handle('/').then((req) => req.text())).resolves.toBe(
			'APIError'
		)
	})

	it('parse headers', async () => {
		const headers = await new Elysia()
			.get('/', ({ headers }) => headers)
			.handle(
				new Request('http://localhost:3000', {
					headers: {
						'Content-Type': 'application/json',
						'X-Test': 'Nagi'
					}
				})
			)
			.then((x) => x.json())

		expect(headers).toEqual({
			'content-type': 'application/json',
			'x-test': 'Nagi'
		})
	})

	it('handle error in Transform', async () => {
		const route = new Elysia().get(
			'/',
			{
				query: t.Object({
					aid: t
						.Codec(t.String())
						.Decode((value) => {
							throw new NotFound('foo')
						})
						.Encode((value) => `1`)
				})
			},
			({ query: { aid } }) => aid
		)

		const response = await new Elysia().use(route).handle('/?aid=a')

		expect(response.status).toEqual(404)
		await expect(response.json()).resolves.toEqual({
			type: 'not-found',
			code: 'not-found',
			title: 'Not Found',
			status: 404,
			detail: 'foo'
		})
	})

	it('map status error to response', async () => {
		const value = { message: 'meow!' }

		const response = await new Elysia()
			.get('/', ({ status }) => {
				throw status(422, value)
			})
			.handle('/')

		await expect(response.json()).resolves.toEqual(value)
		expect(response.headers.get('content-type')).toStartWith(
			'application/json'
		)
		expect(response.status).toEqual(422)
	})

	it('map status error with custom mapResponse', async () => {
		const value = { message: 'meow!' }

		const response = await new Elysia()
			.mapResponse(({ responseValue }) => {
				if (typeof responseValue === 'object')
					return new Response('Don Quixote', {
						headers: {
							'content-type': 'text/plain'
						}
					})
			})
			.get('/', ({ status }) => {
				throw status(422, value)
			})
			.handle('/')

		await expect(response.text()).resolves.toBe('Don Quixote')
		expect(response.headers.get('content-type')).toStartWith('text/plain')
		expect(response.status).toEqual(422)
	})

	it('handle generic error', async () => {
		const res = await new Elysia()
			.get('/', () => {
				// https://youtube.com/shorts/PbIWVPKHfrQ
				throw new Error('a')
			})
			.handle('/')

		await expect(res.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'a'
		})
		expect(res.status).toBe(500)
	})

	it('handle generic error when thrown in handler', async () => {
		const app = new Elysia().get('/', () => {
			throw new Error('a')
		})

		const res = await app.handle('/')

		await expect(res.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'a'
		})
		expect(res.status).toBe(500)
	})

	it('handle Error with toResponse() when returned', async () => {
		class ErrorA extends Error {
			toResponse() {
				return Response.json({ error: 'hello' }, { status: 418 })
			}
		}

		const app = new Elysia().get('/A', () => {
			return new ErrorA()
		})

		const res = await app.handle('/A')

		await expect(res.json()).resolves.toEqual({ error: 'hello' })
		expect(res.status).toBe(418)
	})

	it('handle Error with toResponse() when thrown', async () => {
		class ErrorA extends Error {
			toResponse() {
				return Response.json({ error: 'hello' }, { status: 418 })
			}
		}

		const app = new Elysia().get('/A', () => {
			throw new ErrorA()
		})

		const res = await app.handle('/A')

		await expect(res.json()).resolves.toEqual({ error: 'hello' })
		expect(res.status).toBe(418)
	})

	it('passes through a matching toResponse() Response by reference', async () => {
		const original = Response.json({ error: 'hello' }, { status: 418 })

		class ErrorA extends Error {
			status = 418

			toResponse() {
				return original
			}
		}

		const app = new Elysia().get('/', () => {
			throw new ErrorA()
		})

		const res = await app.handle('/')

		expect(res).toBe(original)
		expect(res.status).toBe(418)
		await expect(res.json()).resolves.toEqual({ error: 'hello' })
	})

	it('handle non-Error with toResponse() when returned', async () => {
		class ErrorB {
			toResponse() {
				return Response.json({ error: 'hello' }, { status: 418 })
			}
		}

		const app = new Elysia().get('/B', () => {
			return new ErrorB()
		})

		const res = await app.handle('/B')

		await expect(res.json()).resolves.toEqual({ error: 'hello' })
		expect(res.status).toBe(418)
	})

	it('handle non-Error with toResponse() when thrown', async () => {
		class ErrorB {
			toResponse() {
				return Response.json({ error: 'hello' }, { status: 418 })
			}
		}

		const app = new Elysia().get('/B', () => {
			throw new ErrorB()
		})

		const res = await app.handle('/B')

		await expect(res.json()).resolves.toEqual({ error: 'hello' })
		expect(res.status).toBe(418)
	})

	it('handle Error with toResponse() that includes custom headers', async () => {
		class ErrorWithHeaders extends Error {
			toResponse() {
				return Response.json(
					{ error: 'custom error' },
					{
						status: 418,
						headers: {
							'X-Custom-Header': 'custom-value',
							'Content-Type': 'application/json; charset=utf-8'
						}
					}
				)
			}
		}

		const app = new Elysia().get('/', () => {
			throw new ErrorWithHeaders()
		})

		const res = await app.handle('/')

		await expect(res.json()).resolves.toEqual({ error: 'custom error' })
		expect(res.status).toBe(418)
		expect(res.headers.get('X-Custom-Header')).toBe('custom-value')
	})

	it('handle async toResponse() when thrown', async () => {
		class AsyncError extends Error {
			async toResponse() {
				// Simulate async operation
				await new Promise((resolve) => setTimeout(resolve, 10))
				return Response.json({ error: 'async error' }, { status: 418 })
			}
		}

		const app = new Elysia().get('/', () => {
			throw new AsyncError()
		})

		const res = await app.handle('/')

		await expect(res.json()).resolves.toEqual({ error: 'async error' })
		expect(res.status).toBe(418)
	})

	it('handle async toResponse() when returned', async () => {
		class AsyncError extends Error {
			async toResponse() {
				// Simulate async operation
				await new Promise((resolve) => setTimeout(resolve, 10))
				return Response.json({ error: 'async error' }, { status: 418 })
			}
		}

		const app = new Elysia().get('/', () => {
			return new AsyncError()
		})

		const res = await app.handle('/')

		await expect(res.json()).resolves.toEqual({ error: 'async error' })
		expect(res.status).toBe(418)
	})

	it('handle async toResponse() with custom headers', async () => {
		class AsyncErrorWithHeaders extends Error {
			async toResponse() {
				await new Promise((resolve) => setTimeout(resolve, 10))
				return Response.json(
					{ error: 'async with headers' },
					{
						status: 419,
						headers: {
							'X-Async-Header': 'async-value'
						}
					}
				)
			}
		}

		const app = new Elysia().get('/', () => {
			throw new AsyncErrorWithHeaders()
		})

		const res = await app.handle('/')

		await expect(res.json()).resolves.toEqual({
			error: 'async with headers'
		})
		expect(res.status).toBe(419)
		expect(res.headers.get('X-Async-Header')).toBe('async-value')
	})

	it('handle non-Error with async toResponse()', async () => {
		class AsyncNonError {
			async toResponse() {
				await new Promise((resolve) => setTimeout(resolve, 10))
				return Response.json(
					{ error: 'non-error async' },
					{ status: 418 }
				)
			}
		}

		const app = new Elysia().get('/', () => {
			throw new AsyncNonError()
		})

		const res = await app.handle('/')

		await expect(res.json()).resolves.toEqual({ error: 'non-error async' })
		expect(res.status).toBe(418)
	})

	it('handle toResponse() that throws an error', async () => {
		class BrokenError extends Error {
			toResponse() {
				throw new Error('toResponse failed')
			}
		}

		const app = new Elysia().get('/', () => {
			throw new BrokenError('original error')
		})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		await expect(res.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'original error'
		})
	})

	it('handle async toResponse() that throws an error', async () => {
		class BrokenAsyncError extends Error {
			async toResponse() {
				throw new Error('async toResponse failed')
			}
		}

		const app = new Elysia().get('/', () => {
			throw new BrokenAsyncError('original error')
		})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		await expect(res.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'original error'
		})
	})

	it('compiled tail awaits async toResponse() when thrown', async () => {
		class AsyncError extends Error {
			status = 503

			async toResponse() {
				await new Promise((resolve) => setTimeout(resolve, 10))
				return new Response('custom', { status: 503 })
			}
		}

		const app = new Elysia()
			.onError(() => {})
			.get('/', () => {
				throw new AsyncError('boom')
			})

		const res = await app.handle('/')

		expect(res.status).toBe(503)
		await expect(res.text()).resolves.toBe('custom')
	})

	it('compiled tail keeps sync toResponse() Response fast path', async () => {
		class SyncError extends Error {
			status = 502

			toResponse() {
				return new Response('custom-sync', { status: 502 })
			}
		}

		const app = new Elysia()
			.onError(() => {})
			.get('/', () => {
				throw new SyncError('boom')
			})

		const res = await app.handle('/')

		expect(res.status).toBe(502)
		await expect(res.text()).resolves.toBe('custom-sync')
	})

	it('compiled tail falls back when async toResponse() rejects', async () => {
		class BrokenAsyncError extends Error {
			async toResponse() {
				throw new Error('async toResponse failed')
			}
		}

		const app = new Elysia()
			.onError(() => {})
			.get('/', () => {
				throw new BrokenAsyncError('original error')
			})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		await expect(res.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'original error'
		})
	})

	it('send set-cookie header when error is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			throw new Error('test error')
		})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
	})

	it('send set-cookie header when response validation error occurs', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Number()
			},
			// @ts-expect-error response is intentionally invalid
			({ cookie }) => {
				cookie.session.value = 'test-session-id'
				return 'invalid response'
			}
		)

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
	})

	it('send set-cookie header when error is thrown with onError hook', async () => {
		const app = new Elysia()
			.onError(({ error }) => {
				return error.message
			})
			.get('/', ({ cookie }) => {
				cookie.session.value = 'test-session-id'
				throw new Error('custom error')
			})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		await expect(res.text()).resolves.toBe('custom error')
		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
	})

	it('send set-cookie header when NotFoundError is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			throw new NotFound()
		})

		const res = await app.handle('/')

		expect(res.status).toBe(404)
		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
	})

	it('send set-cookie header when InternalServerError is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			throw new InternalServerError()
		})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
	})

	it('preserve multiple cookies when error is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'session-123'
			cookie.user.value = 'user-456'
			throw new Error('test error')
		})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		const setCookie = res.headers.get('set-cookie')
		expect(setCookie).toContain('session=session-123')
		expect(setCookie).toContain('user=user-456')
	})

	it('send set-cookie header when error has custom headers', async () => {
		const app = new Elysia().get('/', ({ cookie, set }) => {
			cookie.session.value = 'test-session-id'
			set.headers['x-custom'] = 'value'
			throw new Error('test error')
		})

		const res = await app.handle('/')

		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
		expect(res.headers.get('x-custom')).toBe('value')
	})

	// Nullish thrown values must reach the generic 500 response.
	it('handle thrown nullish value', async () => {
		const logged: unknown[] = []
		const error = console.error
		console.error = (...parameter: unknown[]) => {
			logged.push(parameter[0])
		}

		try {
			for (const thrown of [null, undefined])
				for (const withHook of [false, true]) {
					let app = new Elysia()

					if (withHook)
						app = app.onError(({ set }) => {
							set.headers['x-error-hook'] = 'declined'
						}) as typeof app

					const res = await app
						.get('/', () => {
							throw thrown
						})
						.handle('/')

					expect(res.status).toBe(500)
					expect(res.headers.get('content-type')).toBe(
						'application/problem+json'
					)
					await expect(res.json()).resolves.toEqual({
						type: 'internal-server-error',
						code: 'internal-server-error',
						title: 'Internal Server Error',
						status: 500
					})

					if (withHook)
						expect(res.headers.get('x-error-hook')).toBe('declined')
				}
		} finally {
			console.error = error
		}

		// No fallback error was logged.
		expect(logged).toEqual([])
	})
})

// Development is the default when NODE_ENV is unset, so the development 500
// body is often public. The usual cause of a 500 is a failed upstream call
// wrapped as `new Error('...', { cause })`, and an HTTP client's Error carries
// the upstream response, the request config and the outgoing Authorization
// header. The body names the cause, which is what a developer needs, and
// never serialises it
describe('development 500 cause', () => {
	const clientError = () =>
		Object.assign(new Error('Request failed with status code 401'), {
			name: 'AxiosError',
			config: {
				headers: { Authorization: 'Bearer UPSTREAM-TOKEN' }
			},
			response: {
				status: 401,
				headers: { 'set-cookie': 'upsess=UPSTREAM-COOKIE' },
				data: 'UPSTREAM-BODY'
			}
		})

	const wrapped = (cause: unknown) =>
		new Error('profile lookup failed', { cause })

	const named = {
		type: 'internal-server-error',
		code: 'internal-server-error',
		title: 'Internal Server Error',
		status: 500,
		detail: 'profile lookup failed',
		name: 'Error',
		cause: {
			name: 'AxiosError',
			message: 'Request failed with status code 401'
		}
	}

	// every lane that answers with the 500 body: thrown, returned (mapped
	// apart from the error handler), from a hook, past an onError that
	// declines, and after an await
	const lanes: Record<
		string,
		() => { handle(path: string): Promise<Response> }
	> = {
		thrown: () =>
			new Elysia().get('/', () => {
				throw wrapped(clientError())
			}),
		returned: () => new Elysia().get('/', () => wrapped(clientError())),
		beforeHandle: () =>
			new Elysia().get(
				'/',
				{
					beforeHandle() {
						throw wrapped(clientError())
					}
				},
				() => 'unreachable'
			),
		onError: () =>
			new Elysia()
				.onError(() => {})
				.get('/', () => {
					throw wrapped(clientError())
				}),
		async: () =>
			new Elysia().get('/', async () => {
				await Bun.sleep(0)
				throw wrapped(clientError())
			})
	}

	for (const lane in lanes)
		it(`names an HTTP client cause without its upstream data (${lane})`, async () => {
			const res = await lanes[lane]!().handle('/')
			const text = await res.text()

			expect(res.status).toBe(500)
			expect(text).not.toContain('UPSTREAM')
			expect(JSON.parse(text)).toEqual(named)
		})

	it('names an HTTP client cause in a WebSocket error frame', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message() {
					throw wrapped(clientError())
				}
			})
			.listen(0)

		let ws: WebSocket | undefined

		try {
			ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const msg = wsMessage(ws)
			ws.send('trigger')
			const data = String((await msg).data)

			expect(data).not.toContain('UPSTREAM')
			expect(JSON.parse(data)).toEqual(named)
		} finally {
			if (ws && ws.readyState !== WebSocket.CLOSED) await wsClosed(ws)
			app.stop()
		}
	})

	it('names an Error cause from another realm and a DOMException', async () => {
		// a vm or worker Error fails instanceof, a DOMException fails
		// Error.isError on Bun: either check alone would drop one of them
		const foreign = runInNewContext(`new Error('foreign upstream')`)
		const abort = new DOMException('upstream timed out', 'TimeoutError')

		for (const [cause, name, message] of [
			[foreign, 'Error', 'foreign upstream'],
			[abort, 'TimeoutError', 'upstream timed out']
		] as const) {
			const res = await new Elysia()
				.get('/', () => {
					throw wrapped(cause)
				})
				.handle('/')

			expect(((await res.json()) as { cause: unknown }).cause).toEqual({
				name,
				message
			})
		}
	})

	it('shows a primitive cause and drops any other value', async () => {
		const causeOf = async (cause: unknown) => {
			const body = await new Elysia()
				.get('/', () => {
					throw wrapped(cause)
				})
				.handle('/')
				.then((res) => res.json() as Promise<{ cause?: unknown }>)

			return 'cause' in body ? body.cause : 'absent'
		}

		// a primitive is what the developer wrote, it holds no upstream graph
		expect(await causeOf('ECONNREFUSED 10.0.0.5:5432')).toBe(
			'ECONNREFUSED 10.0.0.5:5432'
		)
		expect(await causeOf(503)).toBe(503)
		expect(await causeOf(false)).toBe(false)

		// a plain object or a Response is an arbitrary graph: a client's
		// response, a request config, a DB handle
		expect(
			await causeOf({
				headers: { authorization: 'Bearer UPSTREAM-TOKEN' }
			})
		).toBe('absent')
		expect(await causeOf(new Response('UPSTREAM-BODY'))).toBe('absent')
	})

	it('serves no cause in production', async () => {
		const nodeEnv = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'

		try {
			for (const cause of [clientError(), 'ECONNREFUSED']) {
				const res = await new Elysia()
					.get('/', () => {
						throw wrapped(cause)
					})
					.handle('/')

				expect(res.status).toBe(500)
				expect(await res.json()).toEqual({
					type: 'internal-server-error',
					code: 'internal-server-error',
					title: 'Internal Server Error',
					status: 500
				})
			}
		} finally {
			if (nodeEnv === undefined) delete process.env.NODE_ENV
			else process.env.NODE_ENV = nodeEnv
		}
	})
})
