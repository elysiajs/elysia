import { Elysia, InternalServerError, NotFoundError, error, t } from '../../src'

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
		const app = new Elysia().get('/', () => {
			throw error(404, 'Not Found :(')
		})

		const response = await app.handle(req('/'))

		expect(await response.text()).toEqual('Not Found :(')
		expect(response.status).toEqual(404)
	})

	it('handle thrown Response', async () => {
		const app = new Elysia().get('/', () => {
			throw error(404, 'Not Found :(')
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
				beforeHandle({ error }) {
					throw error("I'm a teapot", { message: 'meow!' })
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
				error(422, value) as any
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
			.mapResponse(({ response }) => {
				if (typeof response === 'object')
					return new Response('Don Quixote', {
						headers: {
							'content-type': 'text/plain'
						}
					})
			})
			.get('/', () => 'Hello', {
				beforeHandle({ error }) {
					throw error("I'm a teapot", { message: 'meow!' })
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
				error(422, value) as any
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
})
