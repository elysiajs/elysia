import { describe, it, expect } from 'bun:test'
import type { Static } from 'typebox'
import { Elysia, t } from '../../src'
import { post, json } from '../utils'

describe('Normalize', () => {
	it('normalize response', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					hello: t.String()
				})
			},
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			}
		)

		const response = await app.handle('/').then((x) => x.json())

		expect(response).toEqual({
			hello: 'world'
		})
	})

	it('normalize optional response', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Optional(
					t.Object({
						hello: t.String()
					})
				)
			},
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			}
		)

		const response = await app.handle('/').then((x) => x.json())

		expect(response).toEqual({
			hello: 'world'
		})
	})

	it('strictly validate response if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			{
				response: t.Object({
					hello: t.String()
				})
			},
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			}
		)

		const response = await app.handle('/')

		expect(response.status).toEqual(500)
	})

	it('normalize multiple response', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			},
			// @ts-ignore
			({ status }) => status(418, { name: 'Nagisa', hifumi: 'daisuki' })
		)

		const response = await app.handle('/').then((x) => x.json())

		expect(response).toEqual({
			name: 'Nagisa'
		})
	})

	it('strictly validate multiple response', async () => {
		const app = new Elysia({
			normalize: false
		}).get(
			'/',
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			},
			// @ts-ignore
			({ status }) => status(418, { name: 'Nagisa', hifumi: 'daisuki' })
		)

		const response = await app.handle('/')

		expect(response.status).toEqual(500)
	})

	it('normalize multiple response using 200', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			},
			() => {
				return {
					hello: 'Nagisa',
					hifumi: 'daisuki'
				}
			}
		)

		const response = await app.handle('/').then((x) => x.json())

		expect(response).toEqual({
			hello: 'Nagisa'
		})
	})

	it('strictly validate multiple response using 200 if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			},
			() => {
				return {
					hello: 'Nagisa',
					hifumi: 'daisuki'
				}
			}
		)

		const response = await app.handle('/')

		expect(response.status).toEqual(500)
	})

	it('do not normalize response when allowing additional properties', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object(
					{
						hello: t.String()
					},
					{ additionalProperties: true }
				)
			},
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			}
		)

		const response = await app.handle('/').then((x) => x.json())

		expect(response).toEqual({
			hello: 'world',
			a: 'b'
		})
	})

	it('normalize body', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					name: t.String()
				})
			},
			({ body }) => body
		)

		const response = await app
			.handle(
				'/',
				json({
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
		const app = new Elysia().post(
			'/',
			{
				body: t.Optional(
					t.Object({
						name: t.String()
					})
				)
			},
			({ body }) => body
		)

		const response = await app
			.handle(
				'/',
				json({
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
			{
				body: t.Object({
					name: t.String()
				})
			},
			({ body }) => body
		)

		const response = await app.handle(
			'/',
			json({
				name: 'nagisa',
				hifumi: 'daisuki'
			})
		)

		expect(response.status).toBe(422)
	})

	// a schema reused at many positions is one object: closing it at its
	// first position only would let an extra key through the others
	it('strictly validate a reused schema at every position if not normalize', async () => {
		const shared = t.Object({ x: t.Number() })
		const app = new Elysia({ normalize: false })
			.post(
				'/',
				{
					body: t.Object({
						a: shared,
						b: shared,
						list: t.Optional(t.Array(shared)),
						union: t.Optional(t.Union([shared, t.String()]))
					})
				},
				({ body }) => body
			)
			.get('/', { query: t.Object({ a: shared, b: shared }) }, () => 'ok')

		const valid = { a: { x: 1 }, b: { x: 1 } }
		const extra = { x: 1, extra: 1 }
		const statuses = []
		for (const body of [
			valid,
			{ ...valid, b: extra },
			{ ...valid, list: [extra] },
			{ ...valid, union: extra }
		])
			statuses.push((await app.handle('/', json(body))).status)

		const query = (b: unknown) =>
			app.handle(
				'/?a=' +
					encodeURIComponent('{"x":1}') +
					'&b=' +
					encodeURIComponent(JSON.stringify(b))
			)
		statuses.push((await query({ x: 1 })).status)
		statuses.push((await query(extra)).status)

		expect(statuses).toEqual([200, 422, 422, 422, 200, 422])
	})

	// closing every member would reject the other members' keys: an intersect
	// accepts what any member declares and rejects the rest, nested still strict
	it('strictly validate an intersect by its members if not normalize', async () => {
		const x = t.Object({ x: t.Object({ q: t.Number() }) })
		const app = new Elysia({ normalize: false })
			.post(
				'/',
				{ body: t.Intersect([x, t.Object({ y: t.Number() })]) },
				({ body }) => body
			)
			.post(
				'/union',
				{
					body: t.Intersect([
						t.Object({ a: t.Number() }),
						t.Union([
							t.Object({ b: t.Number() }),
							t.Object({ c: t.Number() })
						])
					])
				},
				({ body }) => body
			)
			// one object standalone and as a member
			.post(
				'/shared',
				{
					body: t.Object({
						x,
						i: t.Intersect([x, t.Object({ y: t.Number() })])
					})
				},
				({ body }) => body
			)
			// `unevaluatedProperties` applies to arrays too, it would reject items
			.post(
				'/array',
				{
					body: t.Intersect([
						t.Array(t.Number()),
						t.Array(t.Number())
					])
				},
				({ body }) => body
			)

		const valid = { x: { q: 1 }, y: 2 }
		const statuses = []
		for (const [path, body] of [
			['/', valid],
			['/', { ...valid, z: 1 }],
			['/', { ...valid, x: { q: 1, z: 1 } }],
			['/union', { a: 1, b: 2 }],
			['/union', { a: 1, c: 2 }],
			['/union', { a: 1, b: 2, z: 1 }],
			['/shared', { x: { x: { q: 1 } }, i: valid }],
			['/shared', { x: { x: { q: 1 }, y: 2 }, i: valid }],
			['/shared', { x: { x: { q: 1 } }, i: { ...valid, z: 1 } }],
			['/array', [1]],
			['/array', ['x']]
		] as const)
			statuses.push((await app.handle(path, json(body))).status)

		expect(statuses).toEqual([
			200, 422, 422, 200, 200, 422, 200, 422, 422, 200, 422
		])
	})

	// a def closes for every use: an intersect member pointing to it would
	// reject the other members' keys, so that member reads the def open
	it('strictly validate a cyclic intersect if not normalize', async () => {
		const defs = {
			A: t.Object({
				x: t.Number(),
				n: t.Optional(t.Object({ q: t.Number() }))
			}),
			B: t.Intersect([
				t.Ref('A'),
				t.Object({ y: t.Number(), a: t.Optional(t.Ref('A')) })
			])
		}
		const app = new Elysia({ normalize: false })
			.post('/', { body: t.Cyclic(defs, 'B') }, ({ body }) => body)
			.post('/a', { body: t.Cyclic(defs, 'A') }, ({ body }) => body)
			.post(
				'/list',
				{
					body: t.Cyclic(
						{ L: t.Array(t.Union([t.Number(), t.Ref('L')])) },
						'L'
					)
				},
				({ body }) => body
			)
			// an array def stays clear of `unevaluatedProperties`
			.post(
				'/arrays',
				{
					body: t.Cyclic(
						{
							L: t.Array(t.Number()),
							K: t.Array(t.Number({ minimum: 0 })),
							M: t.Intersect([t.Ref('L'), t.Ref('K')])
						},
						'M'
					)
				},
				({ body }) => body
			)
			// a cyclic member of an outer intersect opens through its own `$defs`
			.post(
				'/nested',
				{
					body: t.Intersect([
						t.Cyclic(defs, 'B'),
						t.Object({ w: t.Number() })
					])
				},
				({ body }) => body
			)

		const valid = { x: 1, y: 2 }
		const statuses = []
		for (const [path, body] of [
			['/', valid],
			['/', { ...valid, z: 1 }],
			['/', { ...valid, n: { q: 1, z: 1 } }],
			['/', { ...valid, a: { x: 1 } }],
			['/', { ...valid, a: { x: 1, y: 2 } }],
			['/a', { x: 1 }],
			['/a', { x: 1, y: 2 }],
			['/list', [1, [2, [3]]]],
			['/arrays', [1]],
			['/nested', { ...valid, w: 3 }],
			['/nested', { ...valid, w: 3, z: 1 }]
		] as const)
			statuses.push((await app.handle(path, json(body))).status)

		expect(statuses).toEqual([
			200, 422, 422, 200, 422, 200, 422, 200, 200, 200, 422
		])
	})

	// a Dependent's branches answer to its `unevaluatedProperties` like
	// intersect members: keys from `if` and the taken branch pass, the rest fail
	it('strictly validate a Dependent by its branches if not normalize', async () => {
		const dependent = () =>
			t.Dependent(
				t.Object({ kind: t.Literal('a') }),
				t.Object({
					a: t.Number(),
					n: t.Optional(t.Object({ q: t.Number() }))
				}),
				t.Object({ kind: t.Literal('b'), b: t.Number() })
			)
		const app = new Elysia({ normalize: false })
			.post('/', { body: dependent() }, ({ body }) => body)
			.post(
				'/member',
				{
					body: t.Intersect([
						t.Object({ x: t.Number() }),
						dependent()
					])
				},
				({ body }) => body
			)
			.post(
				'/property',
				{ body: t.Object({ d: dependent() }) },
				({ body }) => body
			)
			// spec: a failed `if` drops its annotations, else declares its own keys
			.post(
				'/else',
				{
					body: t.Dependent(
						t.Object({ kind: t.Literal('a') }),
						t.Object({ a: t.Number() }),
						t.Object({ b: t.Number() })
					)
				},
				({ body }) => body
			)
			.post(
				'/array',
				{
					body: t.Dependent(
						t.Array(t.Number(), { minItems: 1 }),
						t.Array(t.Number()),
						t.Array(t.Number())
					)
				},
				({ body }) => body
			)
			// `if` is a condition: closing its nested `n` would fail it and take
			// the else branch, accepting what the schema rejects
			.post(
				'/condition',
				{
					body: t.Dependent(
						t.Object({ n: t.Object({ q: t.Number() }) }),
						t.Object({ a: t.Number() }),
						t.Object({ n: t.Any(), b: t.Number() })
					)
				},
				({ body }) => body
			)

		const a = { kind: 'a', a: 1 }
		const b = { kind: 'b', b: 1 }
		const statuses = []
		for (const [path, body] of [
			['/', a],
			['/', { ...a, z: 1 }],
			['/', b],
			['/', { ...b, z: 1 }],
			['/', { kind: 'a', b: 1 }],
			['/', { ...a, n: { q: 1 } }],
			['/', { ...a, n: { q: 1, z: 1 } }],
			['/member', { ...a, x: 1 }],
			['/member', { ...a, x: 1, z: 1 }],
			['/property', { d: a }],
			['/property', { d: { ...a, z: 1 } }],
			['/else', b],
			['/else', { b: 1 }],
			['/array', [1]],
			['/array', ['x']],
			['/condition', { n: { q: 1, z: 1 }, b: 2 }],
			['/condition', { n: { q: 1 }, a: 1 }]
		] as const)
			statuses.push((await app.handle(path, json(body))).status)

		expect(statuses).toEqual([
			200, 422, 200, 422, 422, 200, 422, 200, 422, 200, 422, 422, 200,
			200, 422, 422, 200
		])
	})

	it('loosely validate body if not normalize and has additionalProperties', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			{
				body: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: true
					}
				)
			},
			({ body }) => body
		)

		const response = await app.handle(
			'/',
			json({
				name: 'nagisa',
				hifumi: 'daisuki'
			})
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize query', async () => {
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					name: t.String()
				})
			},
			({ query }) => query
		)

		const response = await app
			.handle('/?name=nagisa&hifumi=daisuki')
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it("don't normalize query on additionalProperties", async () => {
		const app = new Elysia().get(
			'/',
			{
				query: t.Object(
					{
						name: t.String()
					},
					{ additionalProperties: true }
				)
			},
			({ query }) => query
		)

		const response = await app
			.handle('/?name=nagisa&hifumi=daisuki')
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize based on property when normalized is disabled', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			{
				query: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: true
					}
				)
			},
			({ query }) => query
		)

		const response = await app
			.handle('/?name=nagisa&hifumi=daisuki')
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize headers', async () => {
		const app = new Elysia().get(
			'/',
			{
				headers: t.Object({
					name: t.String()
				})
			},
			({ headers }) => headers
		)

		const response = await app
			.handle('/', {
				headers: {
					name: 'nagisa',
					hifumi: 'daisuki'
				}
			})
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('loosely validate headers by default if not normalized', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			{
				headers: t.Object({
					name: t.String()
				})
			},
			({ headers }) => headers
		)

		const headers = {
			name: 'sucrose',
			job: 'alchemist'
		}
		const res = await app.handle('/', {
			headers
		})

		await expect(res.json()).resolves.toEqual(headers)
		expect(res.status).toBe(200)
	})

	it('normalizes property names containing double quotes', async () => {
		const original = console.warn
		console.warn = () => {}

		try {
			const app = new Elysia().post(
				'/',
				{
					body: t.Object({
						'a"b': t.String()
					})
				},
				({ body }) => body
			)

			const res = await app.handle(
				'/',
				json({ 'a"b': 'value', extra: 'strip-me' })
			)

			expect(res.status).toBe(200)
			await expect(res.json()).resolves.toEqual({ 'a"b': 'value' })
		} finally {
			console.warn = original
		}
	})

	it("normalize body with normalize: 'typebox'", async () => {
		const app = new Elysia({ normalize: 'typebox' }).post(
			'/',
			{
				body: t.Object({
					name: t.String()
				})
			},
			({ body }) => body
		)

		const res = await app.handle(
			'/',
			json({ name: 'sucrose', extra: 'strip-me' })
		)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ name: 'sucrose' })
	})

	it('normalize headers when normalize is true', async () => {
		const app = new Elysia({ normalize: true }).get(
			'/',
			{
				headers: t.Object({
					name: t.String()
				})
			},
			({ headers }) => headers
		)

		const res = await app.handle('/', {
			headers: {
				name: 'sucrose',
				job: 'alchemist'
			}
		})

		await expect(res.json()).resolves.toEqual({ name: 'sucrose' })
		expect(res.status).toBe(200)
	})

	it('loosely validate cookie by default if not normalized', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			{
				cookie: t.Cookie({
					name: t.String()
				})
			},
			({ cookie: { name } }) => name.value!
		)

		const res = await app.handle('/', {
			headers: {
				cookie: 'name=sucrose; extra=alchemist'
			}
		})

		await expect(res.text()).resolves.toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('strictly validate headers if not normalized and additionalProperties is false', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			{
				headers: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: false
					}
				)
			},
			({ headers }) => headers
		)

		const response = await app.handle('/', {
			headers: {
				name: 'nagisa',
				hifumi: 'daisuki'
			}
		})

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
		}).get(
			'/test',
			{
				response: responseSchema
			},
			() => service
		)

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
			{
				response: {
					200: type
				}
			},
			() => {
				return [
					{
						id: 'testId',
						date,
						name: 'testName',
						needNormalize: 'yes'
					}
				]
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
			},
			() => ({
				hasMore: true,
				total: 1,
				offset: 0,
				totalPages: 1,
				currentPage: 1,
				items: [{ username: 'Bob', secret: 'shhh' }]
			})
		)

		const data = await app.handle('/').then((x) => x.json())

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
