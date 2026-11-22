import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { Elysia, t } from '../../src'
import { stripRejected } from '../../src/type/validator/clean-safe'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle,
	type Define
} from '../differential/lanes'

// elysiajs/elysia#2051: `normalize` promises that a disallowed property is
// filtered out. A closed object rejects it in Check, before Clean could strip
// it, so a rejected value is stripped and checked once more.

const closed = { additionalProperties: false } as const

const get = (path: string, headers?: Record<string, string>) =>
	new Request(`http://localhost${path}`, { headers })

const post = (path: string, body: unknown) =>
	new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})

const define: Define = (app) =>
	app
		.post(
			'/body',
			{ body: t.Object({ name: t.String() }, closed) },
			({ body }) => body
		)
		.get(
			'/query',
			{ query: t.Object({ a: t.String() }, closed) },
			({ query }) => query
		)
		.get(
			'/headers',
			{ headers: t.Object({ 'x-a': t.String() }, closed) },
			({ headers }) => headers
		)
		.get(
			'/cookie',
			{ cookie: t.Cookie({ a: t.String() }, closed as any) },
			({ cookie }) => cookie.a.value
		)
		// closed below an open root: not a fully closed object
		.post(
			'/nested',
			{
				body: t.Object({
					user: t.Object({ name: t.String() }, closed),
					list: t.Array(t.Object({ x: t.Number() }, closed))
				})
			},
			({ body }) => body
		)
		.post(
			'/codec',
			{ body: t.Object({ n: t.Numeric(), d: t.Date() }, closed) },
			({ body }) => ({ n: body.n, date: body.d instanceof Date })
		)
		.post(
			'/optional',
			{
				body: t.Object(
					{
						filter: t.Optional(
							t.Object({ q: t.Optional(t.String()) }, closed)
						),
						list: t.Optional(
							t.Array(
								t.Object({ x: t.Optional(t.Number()) }, closed)
							)
						)
					},
					closed
				)
			},
			({ body }) => body
		)
		.post(
			'/tuple',
			{
				body: t.Object(
					{ pair: t.Tuple([t.Number(), t.String()]) },
					closed
				)
			},
			({ body }) => body
		)
		.post(
			'/union',
			{
				body: t.Union([
					t.Object({ a: t.Number() }, closed),
					t.Object({ b: t.Number() }, closed)
				])
			},
			({ body }) => body
		)
		.get(
			'/response',
			{ response: t.Object({ name: t.String() }, closed) },
			() => ({ name: 'x', secret: 1 }) as any
		)
		.get(
			'/response/nested',
			{
				response: t.Object({
					user: t.Object({ name: t.String() }, closed)
				})
			},
			() => ({ user: { name: 'x', secret: 1 } }) as any
		)
		.get(
			'/response/status',
			{ response: { 200: t.Object({ name: t.String() }, closed) } },
			() => ({ name: 'x', secret: 1 }) as any
		)
		.get(
			'/response/invalid',
			{ response: t.Object({ name: t.String() }, closed) },
			() => ({ name: 1, secret: 'leak' }) as any
		)

for (const factory of [jitHandle, precompileHandle, aotReconstructHandle])
	describe(`closed object under normalize (${factory.id})`, () => {
		const run = async (
			define: Define,
			request: Request,
			assert: (response: Response) => unknown
		) => {
			const lane = await factory.make(define)

			try {
				await assert(await lane.handle(request))
			} finally {
				await lane.dispose()
			}
		}

		const strips = (request: Request, expected: unknown) =>
			run(define, request, async (response) => {
				expect(response.status).toBe(200)
				expect(await response.json()).toEqual(expected as any)
			})

		const rejects = (request: Request, status = 422) =>
			run(define, request, (response) => {
				expect(response.status).toBe(status)
			})

		it('strips an unknown body property', () =>
			strips(post('/body', { name: 'x', extra: 1 }), { name: 'x' }))

		it('strips an unknown query', () =>
			strips(get('/query?a=1&b=2'), { a: '1' }))

		// every real client sends headers and cookies a schema never lists
		it('strips an unknown header', () =>
			strips(get('/headers', { 'x-a': '1', 'x-b': '2' }), {
				'x-a': '1'
			}))

		it('strips an unknown cookie', () =>
			run(
				define,
				get('/cookie', { cookie: 'a=1; b=2' }),
				async (response) => {
					expect(response.status).toBe(200)
					expect(await response.text()).toBe('1')
				}
			))

		it('strips below an open root and inside an array', () =>
			strips(
				post('/nested', {
					user: { name: 'x', extra: 1 },
					list: [{ x: 1, extra: 1 }, { x: 2 }],
					extra: 1
				}),
				{ user: { name: 'x' }, list: [{ x: 1 }, { x: 2 }] }
			))

		it('strips before decoding a codec member', () =>
			strips(post('/codec', { n: '5', d: '2020-01-01', extra: 1 }), {
				n: 5,
				date: true
			}))

		it('strips an unknown response property', async () => {
			await strips(get('/response'), { name: 'x' })
			await strips(get('/response/nested'), { user: { name: 'x' } })
			await strips(get('/response/status'), { name: 'x' })
		})

		it('keeps the branch of a union the remaining keys match', () =>
			strips(post('/union', { a: 1, extra: 1 }), { a: 1 }))

		// stripping must not hide the error that remains
		it('reports the property that is still wrong', () =>
			run(
				define,
				post('/body', { name: 1, extra: 1 }),
				async (response) => {
					expect(response.status).toBe(422)

					const error = (await response.json()) as any
					expect(error.property).toBe('/name')
				}
			))

		it('rejects a value no branch of a union accepts', () =>
			rejects(post('/union', { c: 1 })))

		// the cleaner runs on a rejected value: it must not turn another
		// type into the object or array the schema asked for
		it('rejects a string where a closed object is expected', () =>
			rejects(post('/optional', { filter: 'abc', extra: 1 })))

		it('rejects a string where an array is expected', () =>
			rejects(post('/optional', { list: 'abc', extra: 1 })))

		it('rejects an object that only claims a length', () =>
			rejects(
				post('/optional', { list: { length: 100_000_000 }, extra: 1 })
			))

		// only an unknown property is stripped, as for an open object
		it('rejects a tuple with more items than declared', () =>
			rejects(post('/tuple', { pair: [1, 'a', 'b'], extra: 1 })))

		it('never sends a response it could not validate', () =>
			run(define, get('/response/invalid'), async (response) => {
				expect(response.status).toBe(500)
				expect(await response.text()).not.toContain('leak')
			}))

		it('strips through a model name and a reference', async () => {
			const models: Define = (app) =>
				app
					.model({ user: t.Object({ name: t.String() }, closed) })
					.post('/model', { body: 'user' }, ({ body }) => body)
					.post(
						'/ref',
						{ body: t.Object({ user: t.Ref('user') }) },
						({ body }) => body
					)

			await run(
				models,
				post('/model', { name: 'x', extra: 1 }),
				async (response) => {
					expect(response.status).toBe(200)
					expect(await response.json()).toEqual({ name: 'x' })
				}
			)
			await run(
				models,
				post('/ref', { user: { name: 'x', extra: 1 } }),
				async (response) => {
					expect(response.status).toBe(200)
					expect(await response.json()).toEqual({
						user: { name: 'x' }
					})
				}
			)
		})

		it('still rejects when normalize is off', () =>
			run(
				() =>
					new Elysia({ normalize: false }).post(
						'/',
						{ body: t.Object({ name: t.String() }, closed) },
						({ body }) => body
					),
				post('/', { name: 'x', extra: 1 }),
				(response) => {
					expect(response.status).toBe(422)
				}
			))

		it('strips with TypeBox Clean', () =>
			run(
				() =>
					new Elysia({ normalize: 'typebox' }).post(
						'/',
						{ body: t.Object({ name: t.String() }, closed) },
						({ body }) => body
					),
				post('/', { name: 'x', extra: 1 }),
				async (response) => {
					expect(response.status).toBe(200)
					expect(await response.json()).toEqual({ name: 'x' })
				}
			))

		// TypeBox Clean drops the items a tuple does not declare, and works in
		// place: neither may reach a value that was rejected
		it('rejects a longer tuple with TypeBox Clean', () =>
			run(
				() =>
					new Elysia({ normalize: 'typebox' }).post(
						'/',
						{
							body: t.Object(
								{ pair: t.Tuple([t.Number(), t.String()]) },
								closed
							)
						},
						({ body }) => body
					),
				post('/', { pair: [1, 'a', 'b'], extra: 1 }),
				(response) => {
					expect(response.status).toBe(422)
				}
			))

		it('leaves the handler value untouched with TypeBox Clean', async () => {
			const value = { name: 'x', secret: 1 }

			await run(
				() =>
					new Elysia({ normalize: 'typebox' }).get(
						'/',
						{ response: t.Object({ name: t.String() }, closed) },
						() => value as any
					),
				get('/'),
				async (response) => {
					expect(await response.json()).toEqual({ name: 'x' })
				}
			)

			expect(value).toEqual({ name: 'x', secret: 1 })
		})

		// the retry cleans once to learn the keys, the pipeline cleans again
		it('sanitizes a stripped value once', () =>
			run(
				() =>
					new Elysia({ sanitize: (value) => value + '!' }).post(
						'/',
						{ body: t.Object({ name: t.String() }, closed) },
						({ body }) => body
					),
				post('/', { name: 'x', extra: 1 }),
				async (response) => {
					expect(await response.json()).toEqual({ name: 'x!' })
				}
			))

		it('sanitizes a stripped value with a codec once', () =>
			run(
				() =>
					new Elysia({ sanitize: (value) => value + '!' }).post(
						'/',
						{
							body: t.Object(
								{ name: t.String(), n: t.Numeric() },
								closed
							)
						},
						({ body }) => body
					),
				post('/', { name: 'x', n: '5', extra: 1 }),
				async (response) => {
					expect(await response.json()).toEqual({ name: 'x!', n: 5 })
				}
			))

		// a closed member sees the other member's keys as unknown
		it('strips in a schema merged with a standard schema', () =>
			run(
				(app) =>
					app.guard(
						{
							schema: 'merge',
							body: t.Object({ a: t.String() }, closed)
						},
						(app) =>
							app.post(
								'/',
								{ body: z.object({ b: z.string() }) },
								({ body }) => body
							)
					),
				post('/', { a: '1', b: '2', extra: 1 }),
				async (response) => {
					expect(response.status).toBe(200)
					expect(await response.json()).toEqual({ a: '1', b: '2' })
				}
			))

		it('rejects a longer tuple in a merged schema', () =>
			run(
				(app) =>
					app.guard(
						{
							schema: 'merge',
							body: t.Object(
								{ pair: t.Tuple([t.Number(), t.String()]) },
								closed
							)
						},
						(app) =>
							app.post(
								'/',
								{ body: z.object({ b: z.string() }) },
								({ body }) => body
							)
					),
				post('/', { pair: [1, 'a', 'b'], b: '2' }),
				(response) => {
					expect(response.status).toBe(422)
				}
			))

		// an entity returned as it was loaded is the case the issue is about
		it('strips a class instance in a response', () => {
			class User {
				id = 1
				name = 'a'
				passwordHash = 'secret'
			}

			return run(
				(app) =>
					app.get(
						'/',
						{
							response: t.Object(
								{ id: t.Number(), name: t.String() },
								closed
							)
						},
						() => new User() as any
					),
				get('/'),
				async (response) => {
					expect(response.status).toBe(200)
					expect(await response.json()).toEqual({ id: 1, name: 'a' })
				}
			)
		})
	})

describe('stripRejected', () => {
	// what an in-place cleaner dropped can't be told from what it was given,
	// so a shortened tuple would pass as stripped
	it('refuses a cleaner that hands back the value it was given', () => {
		const value = { pair: [1, 'a', 'b'], extra: 1 }

		expect(
			stripRejected((value: any) => {
				value.pair.length = 2
				delete value.extra

				return value
			}, value)
		).toBeUndefined()
	})
})
