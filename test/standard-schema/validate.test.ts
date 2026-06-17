import { Elysia } from '../../src'
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { post, req } from '../utils'

describe('Standard Schema Validate', () => {
	it('validate body', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: z.object({
					id: z.number()
				})
			},
			({ body }) => body
		)

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
		const app = new Elysia().get(
			'/',
			{
				query: z.object({
					id: z.coerce.number()
				})
			},
			({ query }) => query
		)

		const value = await app.handle(req('/?id=1')).then((x) => x.json())

		expect(value).toEqual({ id: 1 })

		const invalid = await app.handle(req('/?id=a'))

		expect(invalid.status).toBe(422)
	})

	it('validate params', async () => {
		const app = new Elysia().get(
			'/user/:id',
			{
				params: z.object({
					id: z.coerce.number()
				})
			},
			({ params }) => params
		)

		const value = await app.handle(req('/user/1')).then((x) => x.json())

		expect(value).toEqual({ id: 1 })

		const invalid = await app.handle(req('/user/a'))

		expect(invalid.status).toBe(422)
	})

	it('validate headers', async () => {
		const app = new Elysia().get(
			'/',
			{
				headers: z.object({
					id: z.coerce.number()
				})
			},
			({ headers }) => headers
		)

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
			{
				response: z.boolean()
			},
			// @ts-expect-error deliberately returns an invalid response to assert 422
			({ params: { name } }) => (name === 'lilith' ? undefined : true)
		)

		const exists = await app.handle(req('/fouco'))
		const nonExists = await app.handle(req('/lilith'))

		expect(exists.status).toBe(200)
		expect(nonExists.status).toBe(422)
	})

	it('validate multiple response', async () => {
		const app = new Elysia().get(
			'/:name',
			{
				response: {
					404: z.literal('lilith'),
					418: z.literal('fouco')
				}
			},
			({ params: { name }, status }) =>
				name === 'lilith'
					? status(404, 'lilith')
					: status(418, name as any)
		)

		const exists = await app.handle(req('/fouco'))
		const nonExists = await app.handle(req('/lilith'))

		expect(exists.status).toBe(418)
		expect(nonExists.status).toBe(404)

		const invalid = await app.handle(req('/unknown'))
		expect(invalid.status).toBe(422)
	})

	it('validate multiple schema together', async () => {
		const app = new Elysia().post(
			'/:name',
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
			},
			({ params: { name }, status }) =>
				name === 'lilith'
					? status(404, 'lilith')
					: status(418, name as any)
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
				{
					params: z.object({
						name: z.literal('fouco').or(z.literal('lilith'))
					}),
					response: {
						418: z.literal('fouco')
					}
				},
				({ params: { name }, status }) =>
					name === 'lilith'
						? status(404, 'lilith')
						: status(418, name as any)
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
			as: 'plugin',
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

		const app = new Elysia().use(plugin).post(
			'/:name',
			{
				params: z.object({
					name: z.literal('fouco').or(z.literal('lilith'))
				}),
				response: {
					418: z.literal('fouco')
				}
			},
			({ params: { name }, status }) =>
				name === 'lilith'
					? status(404, 'lilith')
					: status(418, name as any)
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
			{
				cookie: z.object({ test: z.coerce.number() })
			},
			({ cookie: { test } }) => typeof test.value
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
