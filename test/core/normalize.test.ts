import { describe, it, expect } from 'bun:test'
import type { Static } from 'typebox'
import { Elysia, t } from '../../src'
import { post, req } from '../utils'

describe('Normalize', () => {
	it('normalize response', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Object({
					hello: t.String()
				})
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'world'
		})
	})

	it('normalize optional response', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Optional(
					t.Object({
						hello: t.String()
					})
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'world'
		})
	})

	it('strictly validate response if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Object({
					hello: t.String()
				})
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toEqual(422)
	})

	it('normalize multiple response', async () => {
		const app = new Elysia().get(
			'/',
			// @ts-ignore
			({ status }) => status(418, { name: 'Nagisa', hifumi: 'daisuki' }),
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			name: 'Nagisa'
		})
	})

	it('strictly validate multiple response', async () => {
		const app = new Elysia({
			normalize: false
		}).get(
			'/',
			// @ts-ignore
			({ status }) => status(418, { name: 'Nagisa', hifumi: 'daisuki' }),
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toEqual(422)
	})

	it('normalize multiple response using 200', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					hello: 'Nagisa',
					hifumi: 'daisuki'
				}
			},
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'Nagisa'
		})
	})

	it('strictly validate multiple response using 200 if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			() => {
				return {
					hello: 'Nagisa',
					hifumi: 'daisuki'
				}
			},
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toEqual(422)
	})

	it('do not normalize response when allowing additional properties', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Object(
					{
						hello: t.String()
					},
					{ additionalProperties: true }
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'world',
			a: 'b'
		})
	})

	it('normalize body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String()
			})
		})

		const response = await app
			.handle(
				post('/', {
					name: 'nagisa',
					hifumi: 'daisuki'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('normalize optional body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Optional(
				t.Object({
					name: t.String()
				})
			)
		})

		const response = await app
			.handle(
				post('/', {
					name: 'nagisa',
					hifumi: 'daisuki'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('strictly validate body if not normalize', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			({ body }) => body,
			{
				body: t.Object({
					name: t.String()
				})
			}
		)

		const response = await app.handle(
			post('/', {
				name: 'nagisa',
				hifumi: 'daisuki'
			})
		)

		expect(response.status).toBe(422)
	})

	it('loosely validate body if not normalize and has additionalProperties', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			({ body }) => body,
			{
				body: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: true
					}
				)
			}
		)

		const response = await app.handle(
			post('/', {
				name: 'nagisa',
				hifumi: 'daisuki'
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize query', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String()
			})
		})

		const response = await app
			.handle(req('/?name=nagisa&hifumi=daisuki'))
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it("don't normalize query on additionalProperties", async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object(
				{
					name: t.String()
				},
				{ additionalProperties: true }
			)
		})

		const response = await app
			.handle(req('/?name=nagisa&hifumi=daisuki'))
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize based on property when normalized is disabled', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ query }) => query,
			{
				query: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: true
					}
				)
			}
		)

		const response = await app
			.handle(req('/?name=nagisa&hifumi=daisuki'))
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize headers', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String()
			})
		})

		const response = await app
			.handle(
				req('/', {
					headers: {
						name: 'nagisa',
						hifumi: 'daisuki'
					}
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('loosely validate headers by default if not normalized', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ headers }) => headers,
			{
				headers: t.Object({
					name: t.String()
				})
			}
		)

		const headers = {
			name: 'sucrose',
			job: 'alchemist'
		}
		const res = await app.handle(
			req('/', {
				headers
			})
		)

		expect(await res.json()).toEqual(headers)
		expect(res.status).toBe(200)
	})

	it('normalize special-character property names', async () => {
		const original = console.warn
		console.warn = () => {}

		try {
			// a double-quote in a property name breaks exact-mirror codegen
			// before 1.1.1 (SyntaxError) while typebox compiles it fine —
			// normalization must never silently turn off: on exact-mirror
			// < 1.1.1 this exercises the typebox Clean fallback in
			// TypeBoxValidator's catch, on >= 1.1.1 the mirror itself
			const app = new Elysia().post('/', ({ body }) => body, {
				body: t.Object({
					'a"b': t.String()
				})
			})

			const res = await app.handle(
				post('/', { 'a"b': 'value', extra: 'strip-me' })
			)

			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({ 'a"b': 'value' })
		} finally {
			console.warn = original
		}
	})

	it("normalize body with normalize: 'typebox'", async () => {
		const app = new Elysia({ normalize: 'typebox' }).post(
			'/',
			({ body }) => body,
			{
				body: t.Object({
					name: t.String()
				})
			}
		)

		const res = await app.handle(
			post('/', { name: 'sucrose', extra: 'strip-me' })
		)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ name: 'sucrose' })
	})

	it('normalize headers when normalize is true', async () => {
		const app = new Elysia({ normalize: true }).get(
			'/',
			({ headers }) => headers,
			{
				headers: t.Object({
					name: t.String()
				})
			}
		)

		const res = await app.handle(
			req('/', {
				headers: {
					name: 'sucrose',
					job: 'alchemist'
				}
			})
		)

		expect(await res.json()).toEqual({ name: 'sucrose' })
		expect(res.status).toBe(200)
	})

	it('loosely validate cookie by default if not normalized', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ cookie: { name } }) => name.value!,
			{
				cookie: t.Cookie({
					name: t.String()
				})
			}
		)

		const res = await app.handle(
			req('/', {
				headers: {
					cookie: 'name=sucrose; extra=alchemist'
				}
			})
		)

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('strictly validate headers if not normalized and additionalProperties is false', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ headers }) => headers,
			{
				headers: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: false
					}
				)
			}
		)

		const response = await app.handle(
			req('/', {
				headers: {
					name: 'nagisa',
					hifumi: 'daisuki'
				}
			})
		)

		expect(response.status).toBe(422)
	})

	it('response normalization does not mutate', async () => {
		// Long-lived object has a `token` property
		const service = {
			name: 'nagisa',
			status: 'online',
			token: 'secret'
		}

		// ...but this property is hidden by the response schema
		const responseSchema = t.Object({
			name: t.String(),
			status: t.String()
		})

		const app = new Elysia({
			normalize: true
		}).get('/test', () => service, {
			response: responseSchema
		})

		expect(service).toHaveProperty('token')
		const origService = structuredClone(service)

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.body).not.toHaveProperty('token')

		// Expect the `token` property to remain present after `service` object was used in a response
		expect(service).toHaveProperty('token')

		// In fact, expect the `service` to not be mutated at all
		expect(service).toEqual(origService)
	})

	it('normalize nested schema', async () => {
		const type = t.Array(
			t.Object({
				id: t.String(),
				date: t.Date(),
				name: t.String()
			})
		)
		const date = new Date('2025-07-11T00:00:00.000Z')

		const app = new Elysia().get(
			'/',
			() => {
				return [
					{
						id: 'testId',
						date,
						name: 'testName',
						needNormalize: 'yes'
					}
				]
			},
			{
				response: {
					200: type
				}
			}
		)

		const response = (await app
			.handle(new Request('http://localhost:3000/'))
			.then((x) => x.json())) as Static<typeof type>

		expect(response).toEqual([
			{
				id: 'testId',
				// @ts-ignore date is normalized to ISO string by default
				date: date.toISOString(),
				name: 'testName'
			}
		])
	})

	it('normalize Codec response', async () => {
		const app = new Elysia().get(
			'/',
			() => ({
				hasMore: true,
				total: 1,
				offset: 0,
				totalPages: 1,
				currentPage: 1,
				items: [{ username: 'Bob', secret: 'shhh' }]
			}),
			{
				// I don't know why but it must be this exact shape
				response: t.Object({
					hasMore: t.Boolean(),
					items: t.Array(
						t.Object({
							username: t.String()
						})
					),
					total: t
						.Codec(t.Number())
						.Decode((x) => x)
						.Encode((x) => x),
					offset: t.Number({ minimum: 0 }),
					totalPages: t.Number(),
					currentPage: t.Number({ minimum: 1 })
				})
			}
		)

		const data = await app.handle(req('/')).then((x) => x.json())

		expect(data).toEqual({
			hasMore: true,
			items: [
				{
					username: 'Bob'
				}
			],
			total: 1,
			offset: 0,
			totalPages: 1,
			currentPage: 1
		})
	})

})
