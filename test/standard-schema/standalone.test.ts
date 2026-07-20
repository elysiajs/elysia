import { Elysia, t, ValidationError } from '../../src'
import { validationPlan } from '../../src/experimental/validation-plan'
import { Validator } from '../../src/validator'
import { coerceQuery } from '../../src/type/coerce'
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import * as v from 'valibot'
import { type } from 'arktype'
import { post, req } from '../utils'

const counted = <T extends { '~standard': any }>(schema: T) => {
	let calls = 0

	return {
		schema: {
			'~standard': {
				...schema['~standard'],
				validate: (value: unknown) => {
					calls++

					return schema['~standard'].validate(value)
				}
			}
		} as any,
		count: () => calls
	}
}

describe('Standard Schema Standalone', () => {
	it('validate and normalize body', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: z.object({
					id: z.number()
				})
			})
			.post(
				'/',
				{
					body: t.Object({
						name: t.Literal('lilith')
					})
				},
				({ body }) => body
			)

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
			.get(
				'/',
				{
					query: t.Object({
						name: t.Literal('lilith')
					})
				},
				({ query }) => query
			)

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
			.get(
				'/:name/:id',
				{
					params: t.Object({
						name: t.Literal('lilith')
					})
				},
				({ params }) => params
			)

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
			.get(
				'/',
				{
					headers: t.Object({
						name: t.Literal('lilith')
					})
				},
				({ headers }) => headers
			)

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
				{
					response: t.Object({
						name: t.Literal('lilith')
					})
				},
				// @ts-expect-error
				({ params: { name } }) => ({
					name,
					id: name !== 'lilith' ? undefined : 1,
					extra: false
				})
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
				{
					response: {
						404: t.Object({
							name: t.Literal('lilith')
						}),
						418: t.Object({
							name: t.Literal('fouco')
						})
					}
				},
				({ params: { name }, status }) =>
					name === 'lilith'
						? status(404, {
								name,
								id: 1,
								// @ts-expect-error excess property — stripped by response normalization
								extra: false
							})
						: status(418, {
								// @ts-expect-error
								name,
								id: 2,
								extra: false
							})
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
			.error(({ error }) => {
				if (!(error instanceof ValidationError)) console.log(error)
			})
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
				},
				({ params: { name, id }, status }) =>
					name === 'lilith'
						? status(404, {
								name,
								id,
								// @ts-expect-error excess property — stripped by response normalization
								extra: true
							})
						: status(418, {
								name,
								id,
								// @ts-expect-error excess property — stripped by response normalization
								extra: true
							})
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
		const plugin = new Elysia().guard('plugin', {
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
			{
				response: {
					404: t.Object({
						name: t.Literal('lilith')
					}),
					418: t.Object({
						name: t.Literal('fouco')
					})
				}
			},
			({ params: { name }, status }) =>
				name === 'lilith'
					? status(404, {
							name,
							id: 1,
							// @ts-expect-error excess property — stripped by response normalization
							extra: false
						})
					: status(418, {
							// @ts-expect-error
							name,
							id: 2,
							extra: false
						})
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
				},
				({ params: { name, id }, status }) =>
					name === 'lilith'
						? status(404, {
								name,
								id,
								// @ts-expect-error excess property — stripped by response normalization
								extra: true
							})
						: status(418, {
								name,
								id,
								// @ts-expect-error excess property — stripped by response normalization
								extra: true
							})
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
				},
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
							})
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

describe('Standard Schema single-pass validation', () => {
	it('StandardValidator.From validates once per success and reuses the issues in hand on failure', () => {
		const id = counted(z.object({ id: z.number() }))
		const validator = Validator.create(id.schema, {})!

		expect(validator.From!({ id: 1 }, 'body')).toEqual({ id: 1 })
		expect(id.count()).toBe(1)

		try {
			validator.From!({ id: 'a' }, 'body')
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(ValidationError)
			expect((error as ValidationError).errors[0].message).toInclude(
				'expected number'
			)
		}

		expect(id.count()).toBe(2)
	})

	it('MultiValidator.From decodes every member exactly once per request', () => {
		const id = counted(z.object({ id: z.number() }))
		const validator = Validator.create(id.schema, {
			schemas: [t.Object({ name: t.Literal('lilith') })]
		})!

		expect(
			validator.From!({ id: 1, name: 'lilith', extra: false }, 'body')
		).toEqual({ id: 1, name: 'lilith' })
		expect(id.count()).toBe(1)

		expect(() =>
			validator.From!({ id: 'a', name: 'lilith' }, 'body')
		).toThrow(ValidationError)
		expect(id.count()).toBe(2)
	})

	it("MultiValidator.From throws with the failing schema's own errors", () => {
		const id = counted(z.object({ id: z.number() }))
		const validator = Validator.create(id.schema, {
			schemas: [t.Object({ name: t.Literal('lilith') })]
		})!

		try {
			validator.From!({ id: 'a', name: 'fouco' }, 'body')
			expect.unreachable()
		} catch (error) {
			const all = (error as ValidationError).all
			expect(all.length).toBe(1)
			expect(all[0].path).toBe('id')
		}

		try {
			validator.From!({ id: 1, name: 'fouco' }, 'body')
			expect.unreachable()
		} catch (error) {
			const all = (error as ValidationError).all
			expect(all.length).toBe(1)
			expect(all[0].message).toInclude('constant')
		}
	})

	it('MultiValidator.Check keeps lenient decode for codec members and strict Check otherwise', () => {
		for (const [app, sealed] of [
			[undefined, false],
			[undefined, true],
			[{ '~config': { experimental: { validationPlan } } }, false],
			[{ '~config': { experimental: { validationPlan } } }, true]
		]) {
			const lenient = Validator.create(
				counted(z.object({ id: z.coerce.number() })).schema,
				{
					schemas: [t.Object({ ok: t.Boolean() })],
					coerces: coerceQuery(),
					app
				}
			)!
			if (sealed) lenient.seal(false)

			expect(lenient.Check({ id: '1', ok: 'true' })).toBe(true)
			expect(lenient.From!({ id: '1', ok: 'true' }, 'query')).toEqual({
				id: 1,
				ok: true
			})
			expect(lenient.Check({ id: '1', ok: 'maybe' })).toBe(false)
		}

		const strict = Validator.create(
			counted(z.object({ id: z.number() })).schema,
			{ schemas: [t.Object({ n: t.Number() })] }
		)!

		expect(strict.Check({ id: 1, n: 1 })).toBe(true)
		expect(strict.Check({ id: 1, n: '1' })).toBe(false)
		expect(() => strict.From!({ id: 1, n: '1' }, 'body')).toThrow(
			ValidationError
		)
	})

	it('MultiValidator.From does not mutate the input value', () => {
		const validator = Validator.create(
			counted(z.object({ id: z.number() })).schema,
			{ schemas: [t.Object({ name: t.Literal('lilith') })] }
		)!

		const input = { id: 1, name: 'lilith', extra: false }
		validator.From!(input, 'body')

		expect(input).toEqual({ id: 1, name: 'lilith', extra: false })
	})

	it('validates a mixed standalone route with a single validate call per request', async () => {
		const id = counted(z.object({ id: z.number() }))

		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: id.schema
			})
			.post(
				'/',
				{
					body: t.Object({
						name: t.Literal('lilith')
					})
				},
				({ body }) => body
			)

		const value = await app
			.handle(post('/', { id: 1, name: 'lilith', extra: false }))
			.then((x) => x.json())

		expect(value).toEqual({ id: 1, name: 'lilith' })
		expect(id.count()).toBe(1)

		const invalid = await app.handle(post('/', { id: 'a', name: 'lilith' }))

		expect(invalid.status).toBe(422)
		expect(id.count()).toBe(2)
	})

	it('materializes typebox defaults for codec members on the multi path', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				query: z.object({
					id: z.coerce.number()
				})
			})
			.get(
				'/',
				{
					query: t.Object({
						page: t.Number({ default: 1 })
					})
				},
				({ query }) => query
			)

		const value = await app.handle(req('/?id=1')).then((x) => x.json())

		expect(value).toEqual({ id: 1, page: 1 })
	})
})

describe('asynchronous Standard Schema standalone guards', () => {
	const asyncNumberId = {
		'~standard': {
			version: 1,
			vendor: 'test-async',
			validate: async (value: any) =>
				typeof value?.id === 'number'
					? { value }
					: { issues: [{ message: 'id must be a number' }] }
		}
	} as any

	it('rejects input that an async standard member fails', async () => {
		const app = new Elysia()
			.guard({ schema: 'standalone', body: asyncNumberId })
			.post(
				'/',
				{ body: t.Object({ name: t.Literal('lilith') }) },
				({ body }) => body
			)

		const invalid = await app.handle(
			post('/', { id: 'not-a-number', name: 'lilith' })
		)
		expect(invalid.status).toBe(422)
	})

	it('accepts valid input and returns the merged decoded value', async () => {
		const app = new Elysia()
			.guard({ schema: 'standalone', body: asyncNumberId })
			.post(
				'/',
				{ body: t.Object({ name: t.Literal('lilith') }) },
				({ body }) => body
			)

		const res = await app.handle(post('/', { id: 7, name: 'lilith' }))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ id: 7, name: 'lilith' })
	})

	it('marks the validator async so the compiled route awaits it', () => {
		const legacy = Validator.create(asyncNumberId, {
			schemas: [t.Object({ name: t.Literal('lilith') })]
		})
		const candidate = Validator.create(asyncNumberId, {
			schemas: [t.Object({ name: t.Literal('lilith') })],
			app: { '~config': { experimental: { validationPlan } } }
		})

		expect(legacy!.constructor.name).toBe('LegacyMultiValidator')
		expect(candidate!.constructor.name).toBe('ValidationPlanMultiValidator')
		expect(legacy!.isAsync).toBe(true)
		expect(candidate!.isAsync).toBe(true)
	})
})
