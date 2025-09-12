import { Elysia } from '../../src'
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { post, req } from '../utils'

describe('Standard Schema Validate', () => {
	it('validate body', async () => {
		const app = new Elysia()
			.model({
				body: z.object({
					id: z.number()
				})
			})
			.post('/', ({ body }) => body, {
				body: 'body'
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
		const app = new Elysia()
			.model({
				query: z.object({
					id: z.coerce.number()
				})
			})
			.get('/', ({ query }) => query, {
				query: 'query'
			})

		const value = await app.handle(req('/?id=1')).then((x) => x.json())

		expect(value).toEqual({ id: 1 })

		const invalid = await app.handle(req('/?id=a'))

		expect(invalid.status).toBe(422)
	})

	it('validate params', async () => {
		const app = new Elysia()
			.model({
				params: z.object({
					id: z.coerce.number()
				})
			})
			.get('/user/:id', ({ params }) => params, {
				params: 'params'
			})

		const value = await app.handle(req('/user/1')).then((x) => x.json())

		expect(value).toEqual({ id: 1 })

		const invalid = await app.handle(req('/user/a'))

		expect(invalid.status).toBe(422)
	})

	it('validate headers', async () => {
		const app = new Elysia()
			.model({
				headers: z.object({
					id: z.coerce.number()
				})
			})
			.get('/', ({ headers }) => headers, {
				headers: 'headers'
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
		const app = new Elysia()
			.model({
				response: z.boolean()
			})
			.get(
				'/:name',
				// @ts-expect-error
				({ params: { name } }) =>
					name === 'lilith' ? undefined : true,
				{
					response: 'response'
				}
			)

		const exists = await app.handle(req('/fouco'))
		const nonExists = await app.handle(req('/lilith'))

		expect(exists.status).toBe(200)
		expect(nonExists.status).toBe(422)
	})

	it('validate multiple response', async () => {
		const app = new Elysia()
			.model({
				'response.404': z.literal('lilith'),
				'response.418': z.literal('fouco')
			})
			.get(
				'/:name',
				({ params: { name }, status }) =>
					name === 'lilith'
						? status(404, 'lilith')
						: status(418, name as any),
				{
					response: {
						404: 'response.404',
						418: 'response.418'
					}
				}
			)

		const exists = await app.handle(req('/fouco'))
		const nonExists = await app.handle(req('/lilith'))

		expect(exists.status).toBe(418)
		expect(nonExists.status).toBe(404)

		const invalid = await app.handle(req('/unknown'))
		expect(invalid.status).toBe(422)
	})

	it('validate multiple schema together', async () => {
		const app = new Elysia()
			.model({
				body: z.object({
					id: z.number()
				}),
				query: z.object({
					limit: z.coerce.number()
				}),
				params: z.object({
					name: z.literal('fouco').or(z.literal('lilith'))
				}),
				'response.404': z.literal('lilith'),
				'response.418': z.literal('fouco')
			})
			.post(
				'/:name',
				({ params: { name }, status }) =>
					name === 'lilith'
						? status(404, 'lilith')
						: status(418, name as any),
				{
					body: 'body',
					query: 'query',
					params: 'params',
					response: {
						404: 'response.404',
						418: 'response.418'
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
			.model({
				body: z.object({
					id: z.number()
				}),
				query: z.object({
					limit: z.coerce.number()
				}),
				params: z.object({
					name: z.literal('fouco').or(z.literal('lilith'))
				}),
				'response.404': z.literal('lilith'),
				'response.418': z.literal('fouco')
			})
			.guard({
				body: 'body',
				query: 'query',
				response: {
					404: 'response.404'
				}
			})
			.post(
				'/:name',
				({ params: { name }, status }) =>
					name === 'lilith'
						? status(404, 'lilith')
						: status(418, name as any),
				{
					params: 'params',
					response: {
						418: 'response.418'
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
		const plugin = new Elysia()
			.model({
				body: z.object({
					id: z.number()
				}),
				query: z.object({
					limit: z.coerce.number()
				}),
				params: z.object({
					name: z.literal('fouco').or(z.literal('lilith'))
				}),
				'response.404': z.literal('lilith'),
				'response.418': z.literal('fouco')
			})
			.guard({
				as: 'scoped',
				body: 'body',
				query: 'query',
				response: {
					404: 'response.404'
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
						418: 'response.418'
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
})
