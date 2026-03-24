import { Elysia, InternalServerError, NotFoundError, status, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

const request = new Request('http://localhost:8080')

describe('Handle Error', () => {
	it('handle NOT_FOUND', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			// @ts-expect-error private
			.handleError(
				{
					request,
					set: {
						headers: {}
					}
				},
				new NotFoundError()
			)

		expect(await res.text()).toBe('NOT_FOUND')
		expect(res.status).toBe(404)
	})

	it('handle INTERNAL_SERVER_ERROR', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			// @ts-expect-error private
			.handleError(
				{
					request,
					set: {
						headers: {}
					}
				},
				new InternalServerError()
			)

		expect(await res.text()).toBe('INTERNAL_SERVER_ERROR')
		expect(res.status).toBe(500)
	})

	it('handle VALIDATION', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi', {
				query: t.Object({
					name: t.String()
				})
			})
			.handle(req('/'))

		expect(res.status).toBe(422)
	})

	it('use custom error', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			.onError(({ code }) => {
				if (code === 'NOT_FOUND')
					return new Response("I'm a teapot", {
						status: 418
					})
			})
			.handle(req('/not-found'))

		expect(await res.text()).toBe("I'm a teapot")
		expect(res.status).toBe(418)
	})

	it('inject headers to error', async () => {
		const app = new Elysia()
			.onRequest(({ set }) => {
				set.headers['Access-Control-Allow-Origin'] = '*'
			})
			.get('/', () => {
				throw new NotFoundError()
			})

		const res = await app.handle(req('/'))

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
				throw new NotFoundError()
			})

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('aw man')
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

		const response = await app.handle(req('/group/inner'))

		expect(await response.text()).toEqual('handled')
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

		const response = await app.handle(req('/group/inner'))

		expect(await response.text()).toEqual('handled')
		expect(response.status).toEqual(418)
	})

	it('handle thrown error function', async () => {
		const app = new Elysia().get('/', ({ status }) => {
			throw status(404, 'Not Found :(')
		})

		const response = await app.handle(req('/'))

		expect(await response.text()).toEqual('Not Found :(')
		expect(response.status).toEqual(404)
	})

	it('handle thrown Response', async () => {
		const app = new Elysia().get('/', ({ status }) => {
			throw status(404, 'Not Found :(')
		})

		const response = await app.handle(req('/'))

		expect(await response.text()).toEqual('Not Found :(')
		expect(response.status).toEqual(404)
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

		const errors = new Elysia()
			.error({ APIError })
			.onError({ as: 'global' }, ({ code }) => {
				return code
			})

		const requestHandler = new Elysia()
			.onTransform(() => {
				throw new APIError(403, 'Not authorized')
			})
			.get('/', () => 'a')

		const app = new Elysia().use(errors).use(requestHandler)

		expect(await app.handle(req('/')).then((req) => req.text())).toBe(
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
		const route = new Elysia().get('/', ({ query: { aid } }) => aid, {
			query: t.Object({
				aid: t
					.Transform(t.String())
					.Decode((value) => {
						throw new NotFoundError('foo')
					})
					.Encode((value) => `1`)
			})
		})

		let response = await new Elysia({ aot: false })
			.use(route)
			.handle(req('/?aid=a'))

		expect(response.status).toEqual(404)
		expect(await response.text()).toEqual('foo')

		response = await new Elysia({ aot: true })
			.use(route)
			.handle(req('/?aid=a'))
		expect(response.status).toEqual(404)
		expect(await response.text()).toEqual('foo')
	})

	it('map status error to response', async () => {
		const value = { message: 'meow!' }

		const response: Response = await new Elysia()
			.get('/', () => 'Hello', {
				beforeHandle({ status }) {
					throw status("I'm a teapot", { message: 'meow!' })
				}
			})
			// @ts-expect-error private property
			.handleError(
				{
					request: new Request('http://localhost/'),
					set: {
						headers: {}
					}
				},
				status(422, value) as any
			)

		expect(await response.json()).toEqual(value)
		expect(response.headers.get('content-type')).toStartWith(
			'application/json'
		)
		expect(response.status).toEqual(422)
	})

	it('map status error with custom mapResponse', async () => {
		const value = { message: 'meow!' }

		const response: Response = await new Elysia()
			.mapResponse(({ responseValue }) => {
				if (typeof responseValue === 'object')
					return new Response('Don Quixote', {
						headers: {
							'content-type': 'text/plain'
						}
					})
			})
			.get('/', () => 'Hello', {
				beforeHandle({ status }) {
					throw status("I'm a teapot", { message: 'meow!' })
				}
			})
			// @ts-expect-error private property
			.handleError(
				{
					request: new Request('http://localhost/'),
					set: {
						headers: {}
					}
				},
				status(422, value) as any
			)

		expect(await response.text()).toBe('Don Quixote')
		expect(response.headers.get('content-type')).toStartWith('text/plain')
		expect(response.status).toEqual(422)
	})

	it('handle generic error', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			// @ts-expect-error private
			.handleError(
				{
					request,
					set: {
						headers: {}
					}
				},
				// https://youtube.com/shorts/PbIWVPKHfrQ
				new Error('a')
			)

		expect(await res.text()).toBe('a')
		expect(res.status).toBe(500)
	})

	it('handle generic error when thrown in handler', async () => {
		const app = new Elysia().get('/', () => {
			throw new Error('a')
		})

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('a')
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

		const res = await app.handle(req('/A'))

		expect(await res.json()).toEqual({ error: 'hello' })
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

		const res = await app.handle(req('/A'))

		expect(await res.json()).toEqual({ error: 'hello' })
		expect(res.status).toBe(418)
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

		const res = await app.handle(req('/B'))

		expect(await res.json()).toEqual({ error: 'hello' })
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

		const res = await app.handle(req('/B'))

		expect(await res.json()).toEqual({ error: 'hello' })
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

		const res = await app.handle(req('/'))

		expect(await res.json()).toEqual({ error: 'custom error' })
		expect(res.status).toBe(418)
		expect(res.headers.get('X-Custom-Header')).toBe('custom-value')
	})

	it('handle async toResponse() when thrown', async () => {
		class AsyncError extends Error {
			async toResponse() {
				// Simulate async operation
				await new Promise(resolve => setTimeout(resolve, 10))
				return Response.json({ error: 'async error' }, { status: 418 })
			}
		}

		const app = new Elysia().get('/', () => {
			throw new AsyncError()
		})

		const res = await app.handle(req('/'))

		expect(await res.json()).toEqual({ error: 'async error' })
		expect(res.status).toBe(418)
	})

	it('handle async toResponse() when returned', async () => {
		class AsyncError extends Error {
			async toResponse() {
				// Simulate async operation
				await new Promise(resolve => setTimeout(resolve, 10))
				return Response.json({ error: 'async error' }, { status: 418 })
			}
		}

		const app = new Elysia().get('/', () => {
			return new AsyncError()
		})

		const res = await app.handle(req('/'))

		expect(await res.json()).toEqual({ error: 'async error' })
		expect(res.status).toBe(418)
	})

	it('handle async toResponse() with custom headers', async () => {
		class AsyncErrorWithHeaders extends Error {
			async toResponse() {
				await new Promise(resolve => setTimeout(resolve, 10))
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

		const res = await app.handle(req('/'))

		expect(await res.json()).toEqual({ error: 'async with headers' })
		expect(res.status).toBe(419)
		expect(res.headers.get('X-Async-Header')).toBe('async-value')
	})

	it('handle non-Error with async toResponse()', async () => {
		class AsyncNonError {
			async toResponse() {
				await new Promise(resolve => setTimeout(resolve, 10))
				return Response.json({ error: 'non-error async' }, { status: 418 })
			}
		}

		const app = new Elysia().get('/', () => {
			throw new AsyncNonError()
		})

		const res = await app.handle(req('/'))

		expect(await res.json()).toEqual({ error: 'non-error async' })
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

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		expect(await res.text()).toBe('original error')
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

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		expect(await res.text()).toBe('original error')
	})

	it('send set-cookie header when error is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			throw new Error('test error')
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		expect(res.headers.get('set-cookie')).toContain('session=test-session-id')
	})

	it('send set-cookie header when response validation error occurs', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			return 'invalid response'
		}, {
			response: t.Number()
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(422)
		expect(res.headers.get('set-cookie')).toContain('session=test-session-id')
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

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		expect(await res.text()).toBe('custom error')
		expect(res.headers.get('set-cookie')).toContain('session=test-session-id')
	})

	it('send set-cookie header when NotFoundError is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			throw new NotFoundError()
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(404)
		expect(res.headers.get('set-cookie')).toContain('session=test-session-id')
	})

	it('send set-cookie header when InternalServerError is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			throw new InternalServerError()
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		expect(res.headers.get('set-cookie')).toContain('session=test-session-id')
	})

	it('send set-cookie header in AOT mode when error is thrown', async () => {
		const app = new Elysia({ aot: true }).get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			throw new Error('test error')
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		expect(res.headers.get('set-cookie')).toContain('session=test-session-id')
	})

	it('preserve multiple cookies when error is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'session-123'
			cookie.user.value = 'user-456'
			throw new Error('test error')
		})

		const res = await app.handle(req('/'))

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

		const res = await app.handle(req('/'))

		expect(res.headers.get('set-cookie')).toContain('session=test-session-id')
		expect(res.headers.get('x-custom')).toBe('value')
	})
})
