import { Elysia, InternalServerError, NotFound, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Handle Error', () => {
	it('handle NOT_FOUND', async () => {
		const res = await new Elysia()
			.get('/', () => {
				throw new NotFound()
			})
			.handle(req('/'))

		await expect(res.text()).resolves.toBe('Not Found')
		expect(res.status).toBe(404)
	})

	it('handle INTERNAL_SERVER_ERROR', async () => {
		const res = await new Elysia()
			.get('/', () => {
				throw new InternalServerError()
			})
			.handle(req('/'))

		await expect(res.text()).resolves.toBe('Internal Server Error')
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
			.handle(req('/'))

		expect(res.status).toBe(422)
	})

	it('use custom error', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			.error(({ error }) => {
				if (error instanceof NotFound)
					return new Response("I'm a teapot", {
						status: 418
					})
			})
			.handle(req('/not-found'))

		await expect(res.text()).resolves.toBe("I'm a teapot")
		expect(res.status).toBe(418)
	})

	it('inject headers to error', async () => {
		const app = new Elysia()
			.request(({ set }) => {
				set.headers['Access-Control-Allow-Origin'] = '*'
			})
			.get('/', () => {
				throw new NotFound()
			})

		const res = await app.handle(req('/'))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
		expect(res.status).toBe(404)
	})

	it('transform any to error', async () => {
		const app = new Elysia()
			.error(async ({ set }) => {
				set.status = 418

				return 'aw man'
			})
			.get('/', () => {
				throw new NotFound()
			})

		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('aw man')
		expect(res.status).toBe(418)
	})

	it('handle error in group', async () => {
		const authenticate = new Elysia().group('/group', (group) =>
			group
				.get('/inner', () => {
					throw new Error('A')
				})
				.error(() => {
					return 'handled'
				})
		)

		const app = new Elysia().use(authenticate)

		const response = await app.handle(req('/group/inner'))

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
				.error(() => {
					return 'handled'
				})
		)

		const app = new Elysia().use(authenticate)

		const response = await app.handle(req('/group/inner'))

		await expect(response.text()).resolves.toEqual('handled')
		expect(response.status).toEqual(418)
	})

	it('handle thrown error function', async () => {
		const app = new Elysia().get('/', ({ status }) => {
			throw status(404, 'Not Found :(')
		})

		const response = await app.handle(req('/'))

		await expect(response.text()).resolves.toEqual('Not Found :(')
		expect(response.status).toEqual(404)
	})

	it('handle thrown Response', async () => {
		const app = new Elysia().get('/', ({ status }) => {
			throw status(404, 'Not Found :(')
		})

		const response = await app.handle(req('/'))

		await expect(response.text()).resolves.toEqual('Not Found :(')
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

		const errors = new Elysia().error(
			'global',
			APIError,
			({ error }) => error.name
		)

		const requestHandler = new Elysia()
			.transform(() => {
				throw new APIError(403, 'Not authorized')
			})
			.get('/', () => 'a')

		const app = new Elysia().use(errors).use(requestHandler)

		await expect(
			app.handle(req('/')).then((req) => req.text())
		).resolves.toBe('APIError')
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

		const response = await new Elysia().use(route).handle(req('/?aid=a'))

		expect(response.status).toEqual(404)
		await expect(response.text()).resolves.toEqual('foo')
	})

	it('map status error to response', async () => {
		const value = { message: 'meow!' }

		const response = await new Elysia()
			.get('/', ({ status }) => {
				throw status(422, value)
			})
			.handle(req('/'))

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
			.handle(req('/'))

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
			.handle(req('/'))

		await expect(res.text()).resolves.toBe('a')
		expect(res.status).toBe(500)
	})

	it('handle generic error when thrown in handler', async () => {
		const app = new Elysia().get('/', () => {
			throw new Error('a')
		})

		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('a')
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

		const res = await app.handle(req('/A'))

		await expect(res.json()).resolves.toEqual({ error: 'hello' })
		expect(res.status).toBe(418)
	})

	// F29: the finished Response from toResponse() must pass through by
	// reference — set.status already matches, so rewrapping would only
	// clone headers and downgrade the in-memory body to a stream
	it('pass through toResponse() Response by reference when set matches', async () => {
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

		const res = await app.handle(req('/'))

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

		const res = await app.handle(req('/B'))

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

		const res = await app.handle(req('/B'))

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

		const res = await app.handle(req('/'))

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

		const res = await app.handle(req('/'))

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

		const res = await app.handle(req('/'))

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

		const res = await app.handle(req('/'))

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

		const res = await app.handle(req('/'))

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

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		await expect(res.text()).resolves.toBe('original error')
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
		await expect(res.text()).resolves.toBe('original error')
	})

	it('send set-cookie header when error is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			throw new Error('test error')
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
	})

	it('send set-cookie header when response validation error occurs', async () => {
		const app = new Elysia().get(
			'/',
			// assert set-cookie survives the response-validation error
			{
				response: t.Number()
			},
			// @ts-expect-error deliberately returns an invalid response to
			({ cookie }) => {
				cookie.session.value = 'test-session-id'
				return 'invalid response'
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(422)
		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
	})

	it('send set-cookie header when error is thrown with onError hook', async () => {
		const app = new Elysia()
			.error(({ error }) => {
				return error.message
			})
			.get('/', ({ cookie }) => {
				cookie.session.value = 'test-session-id'
				throw new Error('custom error')
			})

		const res = await app.handle(req('/'))

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

		const res = await app.handle(req('/'))

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

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
	})

	it('send set-cookie header when error is thrown', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'test-session-id'
			throw new Error('test error')
		})

		const res = await app.handle(req('/'))

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

		expect(res.headers.get('set-cookie')).toContain(
			'session=test-session-id'
		)
		expect(res.headers.get('x-custom')).toBe('value')
	})
})
