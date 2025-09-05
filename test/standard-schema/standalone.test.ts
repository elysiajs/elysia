import { Elysia, t } from '../../src'
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import * as v from 'valibot'
import { type } from 'arktype'
import { post, req } from '../utils'

describe('Standard Schema Standalone', () => {
	it('validate and normalize body', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: z.object({
					id: z.number()
				})
			})
			.post('/', ({ body }) => body, {
				body: t.Object({
					name: t.Literal('lilith')
				})
			})

		const value = await app
			.handle(
				post('/', {
					id: 1,
					name: 'lilith',
					extra: false
				})
			)
			.then((x) => x.json())

		expect(value).toEqual({ id: 1, name: 'lilith' })

		const invalid = await app.handle(
			post('/', {
				id: '1',
				name: 'fouco',
				extra: false
			})
		)

		expect(invalid.status).toBe(422)
	})

	it('validate query', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				query: z.object({
					id: z.coerce.number()
				})
			})
			.get('/', ({ query }) => query, {
				query: t.Object({
					name: t.Literal('lilith')
				})
			})

		const value = await app
			.handle(req('/?id=1&name=lilith&extra=true'))
			.then((x) => x.json())

		expect(value).toEqual({ id: 1, name: 'lilith' })

		const invalid = await app.handle(req('/?id=a&name=fouco'))

		expect(invalid.status).toBe(422)
	})

	it('validate and normalize params', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				params: z.object({
					id: z.coerce.number()
				})
			})
			.get('/:name/:id', ({ params }) => params, {
				params: t.Object({
					name: t.Literal('lilith')
				})
			})

		const value = await app.handle(req('/lilith/1')).then((x) => x.json())

		expect(value).toEqual({ id: 1, name: 'lilith' })

		const invalid = await app.handle(req('/user/a?name=fouco'))
		expect(invalid.status).toBe(422)
	})

	it('validate and normalize headers', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				headers: z.object({
					id: z.coerce.number()
				})
			})
			.get('/', ({ headers }) => headers, {
				headers: t.Object({
					name: t.Literal('lilith')
				})
			})

		const value = await app
			.handle(
				req('/', {
					headers: {
						id: '1',
						name: 'lilith',
						extra: 'false'
					}
				})
			)
			.then((x) => x.json())

		expect(value).toEqual({ id: 1, name: 'lilith' })

		const invalid = await app.handle(
			req('/', {
				headers: {
					id: 'a',
					name: 'fouco'
				}
			})
		)

		expect(invalid.status).toBe(422)
	})

	it('validate and normalize single response', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				response: z.object({
					id: z.number()
				})
			})
			.get(
				'/:name',
				// @ts-expect-error
				({ params: { name } }) => ({
					name,
					id: name !== 'lilith' ? undefined : 1,
					extra: false
				}),
				{
					response: t.Object({
						name: t.Literal('lilith')
					})
				}
			)

		const valid = await app.handle(req('/lilith')).then((x) => x.json())

		expect(valid).toEqual({ id: 1, name: 'lilith' })

		const invalid = await app.handle(req('/focou'))
		expect(invalid.status).toBe(422)
	})

	it('validate and normalize multiple response', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				response: {
					404: z.object({
						id: z.number()
					}),
					418: z.object({
						id: z.number()
					})
				}
			})
			.get(
				'/:name',
				({ params: { name }, status }) =>
					name === 'lilith'
						? status(404, {
								name,
								id: 1,
								extra: false
							})
						: status(418, {
								// @ts-expect-error
								name,
								id: 2,
								extra: false
							}),
				{
					response: {
						404: t.Object({
							name: t.Literal('lilith')
						}),
						418: t.Object({
							name: t.Literal('fouco')
						})
					}
				}
			)

		const lilith = await app.handle(req('/lilith')).then((x) => x.json())
		const fouco = await app.handle(req('/fouco')).then((x) => x.json())

		expect(lilith).toEqual({ id: 1, name: 'lilith' })
		expect(fouco).toEqual({ id: 2, name: 'fouco' })

		const invalid = await app.handle(req('/unknown'))
		expect(invalid.status).toBe(422)
	})

	it('validate multiple schema together', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: z.object({
					name: z.string()
				}),
				query: z.object({
					id: z.coerce.number()
				}),
				params: z.object({
					id: z.coerce.number()
				}),
				response: {
					404: z.object({
						id: z.number()
					}),
					418: z.object({
						id: z.number()
					})
				}
			})
			.post(
				'/:name/:id',
				({ params: { name, id }, status }) =>
					name === 'lilith'
						? status(404, {
								name,
								id,
								extra: true
							})
						: status(418, {
								name,
								id,
								extra: true
							}),
				{
					body: t.Object({
						id: t.Number()
					}),
					query: t.Object({
						limit: t.Number()
					}),
					params: t.Object({
						name: t.UnionEnum(['fouco', 'lilith'])
					}),
					response: {
						404: z.object({ name: z.literal('lilith') }),
						418: z.object({ name: z.literal('fouco') })
					}
				}
			)

		const responses = await Promise.all(
			[
				post('/lilith/1?limit=1&id=1', {
					id: 1,
					name: 'lilith'
				}),
				post('/fouco/2?limit=10&id=2', {
					id: 2,
					name: 'fouco'
				}),
				post('/unknown/2?limit=10&id=2', {
					id: 2,
					name: 'fouco'
				}),
				post('/fouco/2?limit=a&id=2', {
					id: 2,
					name: 'fouco'
				}),
				post('/fouco/2?limit=10&id=2', {
					id: '2',
					name: 'fouco'
				}),
				post('/fouco/2', {
					id: 2,
					name: 'fouco'
				}),
				post('/fouco/a?limit=10&id=2', {})
			].map((x) => app.handle(x).then((x) => x.status))
		)

		expect(responses[0]).toEqual(404)
		expect(responses[1]).toEqual(418)
		expect(responses[2]).toEqual(422)
		expect(responses[3]).toEqual(422)
		expect(responses[4]).toEqual(422)
		expect(responses[5]).toEqual(422)
		expect(responses[6]).toEqual(422)
	})

	it('merge plugin', async () => {
		const plugin = new Elysia().guard({
			as: 'scoped',
			schema: 'standalone',
			response: {
				404: z.object({
					id: z.number()
				}),
				418: z.object({
					id: z.number()
				})
			}
		})

		const app = new Elysia().use(plugin).get(
			'/:name',
			({ params: { name }, status }) =>
				name === 'lilith'
					? status(404, {
							name,
							id: 1,
							extra: false
						})
					: status(418, {
							// @ts-expect-error
							name,
							id: 2,
							extra: false
						}),
			{
				response: {
					404: t.Object({
						name: t.Literal('lilith')
					}),
					418: t.Object({
						name: t.Literal('fouco')
					})
				}
			}
		)

		const lilith = await app.handle(req('/lilith')).then((x) => x.json())
		const fouco = await app.handle(req('/fouco')).then((x) => x.json())

		expect(lilith).toEqual({ id: 1, name: 'lilith' })
		expect(fouco).toEqual({ id: 2, name: 'fouco' })

		const invalid = await app.handle(req('/unknown'))
		expect(invalid.status).toBe(422)
	})

	it('validate non-typebox schema', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: z.object({
					name: z.string()
				}),
				query: z.object({
					id: z.coerce.number()
				}),
				params: z.object({
					id: z.coerce.number()
				}),
				response: {
					404: z.object({
						id: z.number()
					}),
					418: z.object({
						id: z.number()
					})
				}
			})
			.post(
				'/:name/:id',
				({ params: { name, id }, status }) =>
					name === 'lilith'
						? status(404, {
								name,
								id,
								extra: true
							})
						: status(418, {
								name,
								id,
								extra: true
							}),
				{
					body: v.object({
						id: v.number()
					}),
					query: v.object({
						limit: v.pipe(
							v.string(),
							v.transform(Number),
							v.number()
						)
					}),
					params: v.object({
						name: v.union([v.literal('fouco'), v.literal('lilith')])
					}),
					response: {
						404: v.object({ name: v.literal('lilith') }),
						418: v.object({ name: v.literal('fouco') })
					}
				}
			)

		const responses = await Promise.all(
			[
				post('/lilith/1?limit=1&id=1', {
					id: 1,
					name: 'lilith'
				}),
				post('/fouco/2?limit=10&id=2', {
					id: 2,
					name: 'fouco'
				}),
				post('/unknown/2?limit=10&id=2', {
					id: 2,
					name: 'fouco'
				}),
				post('/fouco/2?limit=a&id=2', {
					id: 2,
					name: 'fouco'
				}),
				post('/fouco/2?limit=10&id=2', {
					id: '2',
					name: 'fouco'
				}),
				post('/fouco/2', {
					id: 2,
					name: 'fouco'
				}),
				post('/fouco/a?limit=10&id=2', {})
			].map((x) => app.handle(x).then((x) => x.status))
		)

		expect(responses[0]).toEqual(404)
		expect(responses[1]).toEqual(418)
		expect(responses[2]).toEqual(422)
		expect(responses[3]).toEqual(422)
		expect(responses[4]).toEqual(422)
		expect(responses[5]).toEqual(422)
		expect(responses[6]).toEqual(422)
	})

	it('validate 3 schema validators without TypeBox', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: z.object({
					name: z.string()
				}),
				query: z.object({
					id: z.coerce.number()
				}),
				params: z.object({
					id: z.coerce.number()
				}),
				response: {
					404: z.object({
						id: z.number()
					}),
					418: z.object({
						id: z.number()
					})
				}
			})
			.guard({
				schema: 'standalone',
				body: type({
					world: '"fantasy"'
				}),
				query: type({
					world: '"fantasy"'
				}),
				response: {
					404: type({
						world: '"fantasy"'
					}),
					418: type({
						world: '"fantasy"'
					})
				}
			})
			.post(
				'/:name/:id',
				({ params: { name, id }, status }) =>
					name === 'lilith'
						? status(404, {
								name,
								id,
								world: 'fantasy'
							})
						: status(418, {
								name,
								id,
								world: 'fantasy'
							}),
				{
					body: v.object({
						id: v.number()
					}),
					query: v.object({
						limit: v.pipe(
							v.string(),
							v.transform(Number),
							v.number()
						)
					}),
					params: v.object({
						name: v.union([v.literal('fouco'), v.literal('lilith')])
					}),
					response: {
						404: v.object({ name: v.literal('lilith') }),
						418: v.object({ name: v.literal('fouco') })
					}
				}
			)

		const responses = await Promise.all(
			[
				post('/lilith/1?limit=1&id=1&world=fantasy', {
					id: 1,
					name: 'lilith',
					world: 'fantasy'
				}),
				post('/fouco/2?limit=10&id=2&world=fantasy', {
					id: 2,
					name: 'fouco',
					world: 'fantasy'
				}),
				post('/unknown/2?limit=10&id=2&world=fantasy', {
					id: 2,
					name: 'fouco',
					world: 'fantasy'
				}),
				post('/unknown/2?limit=10&id=2', {
					id: 2,
					name: 'fouco'
				}),
				post('/fouco/2?limit=a&id=2', {
					id: 2,
					name: 'fouco'
				}),
				post('/fouco/2?limit=10&id=2', {
					id: '2',
					name: 'fouco'
				}),
				post('/fouco/2', {
					id: 2,
					name: 'fouco'
				}),
				post('/fouco/a?limit=10&id=2', {})
			].map((x) => app.handle(x).then((x) => x.status))
		)

		expect(responses[0]).toEqual(404)
		expect(responses[1]).toEqual(418)
		expect(responses[2]).toEqual(422)
		expect(responses[3]).toEqual(422)
		expect(responses[4]).toEqual(422)
		expect(responses[5]).toEqual(422)
		expect(responses[6]).toEqual(422)
		expect(responses[7]).toEqual(422)
	})
})
