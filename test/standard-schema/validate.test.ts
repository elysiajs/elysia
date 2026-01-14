import { Elysia } from '../../src'
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { post, req } from '../utils'

describe('Standard Schema Validate', () => {
	it('validate body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: z.object({
				id: z.number()
			})
		})

		const value = await app
			.handle(
				post('/', {
					id: 1
				})
			)
			.then((x) => x.json())

		expect(value).toEqual({ id: 1 })

		const invalid = await app.handle(
			post('/', {
				id: '1'
			})
		)

		expect(invalid.status).toBe(422)
	})

	it('validate query', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: z.object({
				id: z.coerce.number()
			})
		})

		const value = await app.handle(req('/?id=1')).then((x) => x.json())

		expect(value).toEqual({ id: 1 })

		const invalid = await app.handle(req('/?id=a'))

		expect(invalid.status).toBe(422)
	})

	it('validate params', async () => {
		const app = new Elysia().get('/user/:id', ({ params }) => params, {
			params: z.object({
				id: z.coerce.number()
			})
		})

		const value = await app.handle(req('/user/1')).then((x) => x.json())

		expect(value).toEqual({ id: 1 })

		const invalid = await app.handle(req('/user/a'))

		expect(invalid.status).toBe(422)
	})

	it('validate headers', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: z.object({
				id: z.coerce.number()
			})
		})

		const value = await app
			.handle(
				req('/', {
					headers: {
						id: '1'
					}
				})
			)
			.then((x) => x.json())

		expect(value).toEqual({ id: 1 })

		const invalid = await app.handle(req('/', {}))

		expect(invalid.status).toBe(422)
	})

	it('validate single response', async () => {
		const app = new Elysia().get(
			'/:name',
			// @ts-expect-error
			({ params: { name } }) => (name === 'lilith' ? undefined : true),
			{
				response: z.boolean()
			}
		)

		const exists = await app.handle(req('/fouco'))
		const nonExists = await app.handle(req('/lilith'))

		expect(exists.status).toBe(200)
		// Response validation errors return 500 (server error) - see issue #1480
		expect(nonExists.status).toBe(500)
	})

	it('validate multiple response', async () => {
		const app = new Elysia().get(
			'/:name',
			({ params: { name }, status }) =>
				name === 'lilith'
					? status(404, 'lilith')
					: status(418, name as any),
			{
				response: {
					404: z.literal('lilith'),
					418: z.literal('fouco')
				}
			}
		)

		const exists = await app.handle(req('/fouco'))
		const nonExists = await app.handle(req('/lilith'))

		expect(exists.status).toBe(418)
		expect(nonExists.status).toBe(404)

		const invalid = await app.handle(req('/unknown'))
		// Response validation errors return 500 (server error) - see issue #1480
		expect(invalid.status).toBe(500)
	})

	it('validate multiple schema together', async () => {
		const app = new Elysia().post(
			'/:name',
			({ params: { name }, status }) =>
				name === 'lilith'
					? status(404, 'lilith')
					: status(418, name as any),
			{
				body: z.object({
					id: z.number()
				}),
				query: z.object({
					limit: z.coerce.number()
				}),
				params: z.object({
					name: z.literal('fouco').or(z.literal('lilith'))
				}),
				response: {
					404: z.literal('lilith'),
					418: z.literal('fouco')
				}
			}
		)

		const responses = await Promise.all(
			[
				post('/lilith?limit=1', {
					id: 1
				}),
				post('/fouco?limit=10', {
					id: 2
				}),
				post('/unknown?limit=10', {
					id: 2
				}),
				post('/fouco?limit=a', {
					id: 2
				}),
				post('/fouco?limit=10', {
					id: '2'
				}),
				post('/fouco', {})
			].map((x) => app.handle(x).then((x) => x.status))
		)

		expect(responses[0]).toEqual(404)
		expect(responses[1]).toEqual(418)
		expect(responses[2]).toEqual(422)
		expect(responses[3]).toEqual(422)
		expect(responses[4]).toEqual(422)
		expect(responses[5]).toEqual(422)
	})

	it('merge guard', async () => {
		const app = new Elysia()
			.guard({
				body: z.object({
					id: z.number()
				}),
				query: z.object({
					limit: z.coerce.number()
				}),
				response: {
					404: z.literal('lilith')
				}
			})
			.post(
				'/:name',
				({ params: { name }, status }) =>
					name === 'lilith'
						? status(404, 'lilith')
						: status(418, name as any),
				{
					params: z.object({
						name: z.literal('fouco').or(z.literal('lilith'))
					}),
					response: {
						418: z.literal('fouco')
					}
				}
			)

		const responses = await Promise.all(
			[
				post('/lilith?limit=1', {
					id: 1
				}),
				post('/fouco?limit=10', {
					id: 2
				}),
				post('/unknown?limit=10', {
					id: 2
				}),
				post('/fouco?limit=a', {
					id: 2
				}),
				post('/fouco?limit=10', {
					id: '2'
				}),
				post('/fouco', {})
			].map((x) => app.handle(x).then((x) => x.status))
		)

		expect(responses[0]).toEqual(404)
		expect(responses[1]).toEqual(418)
		expect(responses[2]).toEqual(422)
		expect(responses[3]).toEqual(422)
		expect(responses[4]).toEqual(422)
		expect(responses[5]).toEqual(422)
	})

	it('merge plugin', async () => {
		const plugin = new Elysia().guard({
			as: 'scoped',
			body: z.object({
				id: z.number()
			}),
			query: z.object({
				limit: z.coerce.number()
			}),
			response: {
				404: z.literal('lilith')
			}
		})

		const app = new Elysia()
			.use(plugin)
			.post(
				'/:name',
				({ params: { name }, status }) =>
					name === 'lilith'
						? status(404, 'lilith')
						: status(418, name as any),
				{
					params: z.object({
						name: z.literal('fouco').or(z.literal('lilith'))
					}),
					response: {
						418: z.literal('fouco')
					}
				}
			)

		const responses = await Promise.all(
			[
				post('/lilith?limit=1', {
					id: 1
				}),
				post('/fouco?limit=10', {
					id: 2
				}),
				post('/unknown?limit=10', {
					id: 2
				}),
				post('/fouco?limit=a', {
					id: 2
				}),
				post('/fouco?limit=10', {
					id: '2'
				}),
				post('/fouco', {})
			].map((x) => app.handle(x).then((x) => x.status))
		)

		expect(responses[0]).toEqual(404)
		expect(responses[1]).toEqual(418)
		expect(responses[2]).toEqual(422)
		expect(responses[3]).toEqual(422)
		expect(responses[4]).toEqual(422)
		expect(responses[5]).toEqual(422)
	})

	it('handle cookie', async () => {
		const app = new Elysia().get(
			'test',
			({ cookie: { test } }) => typeof test.value,
			{
				cookie: z.object({ test: z.coerce.number() })
			}
		)

		const value = await app
			.handle(
				new Request('http://localhost:3000/test', {
					headers: {
						cookie: 'test=123'
					}
				})
			)
			.then((x) => x.text())

		expect(value).toBe('number')
	})
})
