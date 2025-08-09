import { Context, Elysia, t, ValidationError } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Query Validator', () => {
	it('validate single', async () => {
		const app = new Elysia().get('/', ({ query: { name } }) => name, {
			query: t.Object({
				name: t.String()
			})
		})
		const res = await app.handle(req('/?name=sucrose'))

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate with hyphen in key', async () => {
		const app = new Elysia().get(
			'/',
			({ query }) => query['character-name'],
			{
				query: t.Object({
					'character-name': t.String()
				})
			}
		)
		const res = await app.handle(req('/?character-name=sucrose'))

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate with dot in key', async () => {
		const app = new Elysia().get(
			'/',
			({ query }) => query['character.name'],
			{
				query: t.Object({
					'character.name': t.String()
				})
			}
		)
		const res = await app.handle(req('/?character.name=sucrose'))

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate multiple', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.String()
			})
		})
		const res = await app.handle(
			req('/?name=sucrose&job=alchemist&trait=dog')
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			trait: 'dog'
		})
		expect(res.status).toBe(200)
	})

	it('parse without reference', async () => {
		const app = new Elysia().get('/', () => '', {
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.String()
			})
		})
		const res = await app.handle(
			req('/?name=sucrose&job=alchemist&trait=dog')
		)

		expect(res.status).toBe(200)
	})

	it('validate optional', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String())
			})
		})
		const res = await app.handle(req('/?name=sucrose&job=alchemist'))

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist'
		})
		expect(res.status).toBe(200)
	})

	it('parse single numeric', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Numeric()
			})
		})
		const res = await app.handle(req('/?name=sucrose&job=alchemist&age=16'))

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			age: 16
		})
		expect(res.status).toBe(200)
	})

	it('parse multiple numeric', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Numeric(),
				rank: t.Numeric()
			})
		})
		const res = await app.handle(
			req('/?name=sucrose&job=alchemist&age=16&rank=4')
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			age: 16,
			rank: 4
		})
		expect(res.status).toBe(200)
	})

	it('parse single integer', async () => {
		const app = new Elysia().get('/', ({ query: { limit } }) => limit, {
			query: t.Object({
				limit: t.Integer()
			})
		})
		const res = await app.handle(req('/?limit=16'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('16')
	})

	it('parse multiple integer', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				limit: t.Integer(),
				offset: t.Integer()
			})
		})
		const res = await app.handle(req('/?limit=16&offset=0'))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ limit: 16, offset: 0 })
	})

	it('validate partial', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Partial(
				t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String())
				})
			)
		})
		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({})
	})

	it('parse numeric with partial', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Partial(
				t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String()),
					age: t.Numeric(),
					rank: t.Numeric()
				})
			)
		})
		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({})
	})

	it('parse boolean string', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				param1: t.BooleanString()
			})
		})
		const res = await app.handle(req('/?param1=true'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ param1: true })
	})

	it('parse optional boolean string', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				param1: t.Optional(t.BooleanString({ default: true }))
			})
		})
		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ param1: true })
	})

	it('parse optional boolean string with second parameter', async () => {
		const schema = t.Object({
			registered: t.Optional(t.Boolean()),
			other: t.String()
		})
		const app = new Elysia().get('/', ({ query }) => query, {
			query: schema
		})
		const res = await app.handle(req('/?other=sucrose'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ other: 'sucrose' })
	})

	it('parse optional boolean string with default value', async () => {
		const schema = t.Object({
			registered: t.Optional(t.Boolean({ default: true })),
			other: t.String()
		})
		const app = new Elysia().get('/', ({ query }) => query, {
			query: schema
		})
		const res = await app.handle(req('/?other=sucrose'))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ other: 'sucrose', registered: true })
	})

	it('validate optional object', async () => {
		const app = new Elysia().get(
			'/',
			({ query }) => query?.name ?? 'sucrose',
			{
				query: t.Optional(
					t.Object(
						{
							name: t.String()
						},
						{
							additionalProperties: true
						}
					)
				)
			}
		)

		const [valid, invalid] = await Promise.all([
			app.handle(req('/?name=sucrose')),
			app.handle(req('/'))
		])

		expect(await valid.text()).toBe('sucrose')
		expect(valid.status).toBe(200)

		expect(await invalid.text()).toBe('sucrose')
		expect(invalid.status).toBe(200)
	})

	it('create default string query', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				faction: t.String({ default: 'tea_party' })
			})
		})

		const value = await app
			.handle(req('/?name=nagisa'))
			.then((x) => x.json())

		expect(value).toEqual({
			name: 'nagisa',
			faction: 'tea_party'
		})
	})

	it('create default number query', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				rank: t.Number({ default: 1 })
			})
		})

		const value = await app
			.handle(req('/?name=nagisa'))
			.then((x) => x.json())

		expect(value).toEqual({
			name: 'nagisa',
			rank: 1
		})
	})

	it('handle query edge case', async () => {
		const checker = {
			check(ctx: Context, name: string, state?: string) {
				return typeof state !== 'undefined'
			}
		}

		const app = new Elysia()
			.derive((ctx) => {
				const { name } = ctx.params

				return {
					check() {
						const { state } = ctx.query

						// @ts-expect-error
						if (!checker.check(ctx, name, state ?? ctx.query.state))
							throw new Error('State mismatch')
					}
				}
			})
			.get('/:name', ({ check }) => {
				check()

				return 'yay'
			})

		const response = await app
			.handle(req('/a?state=123'))
			.then((x) => x.text())

		expect(response).toBe('yay')
	})

	it('parse query array', async () => {
		const params = new URLSearchParams()
		params.append('keys', '1')
		params.append('keys', '2')

		const response = await new Elysia()
			.get('/', ({ query }) => query, {
				query: t.Object({
					keys: t.Array(t.String())
				})
			})
			.handle(new Request(`http://localhost/?${params.toString()}`))
			.then((res) => res.json())

		expect(response).toEqual({ keys: ['1', '2'] })
	})

	it('parse query object', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				role: t.Optional(
					t.Array(
						t.Object({
							name: t.String()
						})
					)
				)
			})
		})

		const response = await app
			.handle(
				req(
					`/?role=${JSON.stringify([
						{ name: 'hello' },
						{ name: 'world' }
					])}`
				)
			)
			.then((x) => x.json())

		expect(response).toEqual({
			role: [{ name: 'hello' }, { name: 'world' }]
		})
	})

	it('parse optional query object', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Optional(
				t.Object({
					role: t.Optional(
						t.Array(
							t.Object({
								name: t.String()
							})
						)
					)
				})
			)
		})

		const response = await app
			.handle(
				req(
					`/?role=${JSON.stringify([
						{ name: 'hello' },
						{ name: 'world' }
					])}`
				)
			)
			.then((x) => x.json())

		expect(response).toEqual({
			role: [{ name: 'hello' }, { name: 'world' }]
		})
	})

	it('parse array with nested object', async () => {
		const params = new URLSearchParams()
		params.append('keys', JSON.stringify({ a: 'hello' }))
		params.append('keys', JSON.stringify({ a: 'hi' }))

		const response = await new Elysia()
			.get('/', ({ query }) => query, {
				query: t.Object({
					keys: t.Array(
						t.Object({
							a: t.String()
						})
					)
				})
			})
			.handle(new Request(`http://localhost/?${params.toString()}`))
			.then((res) => res.json())

		expect(response).toEqual({
			keys: [{ a: 'hello' }, { a: 'hi' }]
		})
	})

	it('parse optional array with nested object', async () => {
		const params = new URLSearchParams()
		params.append('keys', JSON.stringify({ a: 'hello' }))
		params.append('keys', JSON.stringify({ a: 'hi' }))

		const response = await new Elysia()
			.get('/', ({ query }) => query, {
				query: t.Optional(
					t.Object({
						keys: t.Array(
							t.Object({
								a: t.String()
							})
						)
					})
				)
			})
			.handle(new Request(`http://localhost/?${params.toString()}`))
			.then((res) => res.json())

		expect(response).toEqual({
			keys: [{ a: 'hello' }, { a: 'hi' }]
		})
	})

	it('parse query object array without schema', async () => {
		const params = new URLSearchParams()
		params.append('keys', JSON.stringify({ a: 'hello' }))
		params.append('keys', JSON.stringify({ a: 'hi' }))

		const response = await new Elysia()
			.get('/', ({ query }) => query, {
				query: t.Optional(
					t.Object({
						keys: t.Array(
							t.Object({
								a: t.String()
							})
						)
					})
				)
			})
			.handle(new Request(`http://localhost/?${params.toString()}`))
			.then((res) => res.json())

		expect(response).toEqual({
			keys: [{ a: 'hello' }, { a: 'hi' }]
		})
	})

	// People don't expect this
	// @see: https://x.com/saltyAom/status/1813236251321069918
	// it('parse query array without schema', async () => {
	// 	let value: string[] | undefined

	// 	const response = await new Elysia()
	// 		.get('/', ({ query: { keys } }) => value = keys)
	// 		.handle(new Request(`http://localhost/?id=1&id=2`))
	// 		.then((res) => res.json())

	// 	expect(value).toEqual(['1', '2'])
	// })

	it("don't parse query object without schema", async () => {
		const app = new Elysia().get('/', ({ query: { role } }) => role)

		const response = await app
			.handle(req(`/?role=${JSON.stringify({ name: 'hello' })}`))
			.then((x) => x.text())

		expect(response).toBe(JSON.stringify({ name: 'hello' }))
	})

	it('parse union primitive and object', async () => {
		const app = new Elysia().get('/', ({ query: { ids } }) => ids, {
			query: t.Object({
				ids: t.Union([
					t.Array(
						t.Union([t.Object({ a: t.String() }), t.Numeric()])
					),
					t.Numeric()
				])
			})
		})

		const response = await app
			.handle(req(`/?ids=1&ids=${JSON.stringify({ a: 'b' })}`))
			.then((res) => res.json())

		expect(response).toEqual([1, { a: 'b' }])
	})

	it('coerce number object to numeric', async () => {
		const app = new Elysia().get('/', ({ query: { id } }) => typeof id, {
			query: t.Object({
				id: t.Number()
			})
		})

		const value = await app.handle(req('/?id=1')).then((x) => x.text())

		expect(value).toBe('number')
	})

	it('coerce string object to boolean', async () => {
		const app = new Elysia().get(
			'/',
			({ query: { isAdmin } }) => typeof isAdmin,
			{
				query: t.Object({
					isAdmin: t.Boolean()
				})
			}
		)

		const value = await app
			.handle(req('/?isAdmin=true'))
			.then((x) => x.text())

		expect(value).toBe('boolean')
	})

	it("don't parse object automatically unless explicitly specified", async () => {
		let value: string | undefined

		const app = new Elysia().get(
			'/',
			({ query: { pagination } }) => (value = pagination as string)
		)

		await app.handle(
			req(
				`/?pagination=${JSON.stringify({ pageIndex: 1, pageLimit: 10 })}`
			)
		)

		expect(value).toEqual(JSON.stringify({ pageIndex: 1, pageLimit: 10 }))
	})

	it('handle object array in single query', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				pagination: t.Array(
					t.Object({
						pageIndex: t.Number(),
						pageLimit: t.Number()
					})
				)
			})
		})

		const response = await app
			.handle(
				req(
					`/?pagination=${JSON.stringify([{ pageIndex: 1, pageLimit: 10 }])}`
				)
			)
			.then((x) => x.json())

		expect(response).toEqual({
			pagination: [{ pageIndex: 1, pageLimit: 10 }]
		})
	})

	it('handle merge object to array in multiple query', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				pagination: t.Array(
					t.Object({
						pageIndex: t.Number(),
						pageLimit: t.Number()
					})
				)
			})
		})

		const response = await app
			.handle(
				req(
					`/?pagination=${JSON.stringify({ pageIndex: 1, pageLimit: 10 })}&pagination=${JSON.stringify({ pageIndex: 2, pageLimit: 9 })}`
				)
			)
			.then((x) => x.json())

		expect(response).toEqual({
			pagination: [
				{ pageIndex: 1, pageLimit: 10 },
				{ pageIndex: 2, pageLimit: 9 }
			]
		})
	})

	it('don\t coerce number in nested object', async () => {
		const app = new Elysia().get('/', ({ query: { user } }) => user, {
			query: t.Object({
				user: t.Object({
					id: t.Number(),
					name: t.String()
				})
			})
		})

		const response = await app.handle(
			req(
				`?user=${JSON.stringify({
					id: '2',
					name: 'test'
				})}`
			)
		)

		expect(response.status).toBe(422)
	})

	it('handle optional at root', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Optional(
				t.Object({
					id: t.Numeric()
				})
			)
		})

		const res = await Promise.all([
			app.handle(req('/')).then((x) => x.json()),
			app.handle(req('/?id=1')).then((x) => x.json())
		])

		expect(res).toEqual([{}, { id: 1 }])
	})

	it('parse query array in multiple location correctly', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				leading: t.String(),
				arr: t.Array(t.String()),
				trailing: t.String()
			})
		})

		const response = await app
			.handle(req('/?leading=foo&arr=bar&arr=baz&trailing=qux&arr=xd'))
			.then((x) => x.json())

		expect(response).toEqual({
			leading: 'foo',
			arr: ['bar', 'baz', 'xd'],
			trailing: 'qux'
		})
	})

	it('parse + in query', async () => {
		const api = new Elysia().get('', ({ query }) => query, {
			query: t.Object({
				keyword: t.String()
			})
		})

		const url = new URL('http://localhost:3000/')
		url.searchParams.append('keyword', 'hello world')
		// console.log(url.href) //http://localhost:3000/?keyword=hello+world

		const result = await api
			.handle(new Request(url.href))
			.then((response) => response.json())

		expect(result).toEqual({
			keyword: 'hello world'
		})
	})

	// https://github.com/elysiajs/elysia/issues/929
	it('slice non-ASCII querystring offset correctly', async () => {
		const app = new Elysia().get('/', () => 'ok', {
			query: t.Object({
				key1: t.Union([t.Array(t.String()), t.String()])
			})
		})

		expect(
			await app
				.handle(req('/?key1=ab&key1=cd&z=が'))
				.then((x) => x.status)
		).toEqual(200)

		expect(
			await app.handle(req('/?key1=ab&z=が')).then((x) => x.status)
		).toEqual(200)

		expect(
			await app.handle(req('/?key1=ab&key1=cd&z=x')).then((x) => x.status)
		).toEqual(200)

		expect(
			await app
				.handle(req('/?z=が&key1=ab&key1=cd'))
				.then((x) => x.status)
		).toEqual(200)

		expect(
			await app.handle(req('/?key1=で&key1=が&z=x')).then((x) => x.status)
		).toEqual(200)
	})

	// https://github.com/elysiajs/elysia/issues/912
	it('handle JavaScript date numeric offset', () => {
		const api = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				date: t.Date()
			})
		})

		api.handle(req(`/?date=${Date.now()}`)).then((x) => x.json())
	})

	it('handle nuqs format when specified as Array', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				a: t.Array(t.String())
			})
		})

		const response = await app.handle(req('/?a=a,b')).then((x) => x.json())

		expect(response).toEqual({
			a: ['a', 'b']
		})
	})

	it('handle nuqs format when specified as number', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				a: t.Array(t.Numeric())
			})
		})

		const response = await app.handle(req('/?a=1,2')).then((x) => x.json())

		expect(response).toEqual({
			a: [1, 2]
		})
	})

	it('handle nuqs format when specified as boolean', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				a: t.Array(t.BooleanString())
			})
		})

		const response = await app
			.handle(req('/?a=true,false'))
			.then((x) => x.json())

		expect(response).toEqual({
			a: [true, false]
		})
	})

	// https://github.com/elysiajs/elysia/issues/1015
	it('handle ref transform', async () => {
		const app = new Elysia()
			.model({
				myModel: t.Object({ num: t.Number() })
			})
			.get(
				'/',
				({ query: { num } }) => ({
					num,
					type: typeof num
				}),
				{
					query: 'myModel'
				}
			)

		const response = await app
			.handle(new Request('http://localhost?num=1&a=2'))
			.then((x) => x.json())

		expect(response).toEqual({ num: 1, type: 'number' })
	})

	// https://github.com/elysiajs/elysia/issues/1068
	it('handle ref transform with ref inside reference model', async () => {
		const app = new Elysia()
			.model({
				num2: t.Number(),
				myModel: t.Object({ num: t.Number(), num2: t.Ref('num2') })
			})
			.get(
				'/',
				({ query: { num, num2 } }) => ({
					num,
					numType: typeof num,
					num2,
					num2Type: typeof num2
				}),
				{
					query: 'myModel'
				}
			)

		const response = await app
			.handle(new Request('http://localhost?num=1&num2=2'))
			.then((x) => x.json())

		expect(response).toEqual({
			num: 1,
			numType: 'number',
			num2: 2,
			num2Type: 'number'
		})
	})

	it('handle "&" inside a query value', async () => {
		const app = new Elysia().get(
			'*',
			({ query, request }) => ({
				query,
				url: {
					test: new URL(request.url).searchParams.get('test')
				}
			}),
			{
				query: t.Object({
					test: t.String()
				})
			}
		)

		const url = "https://localhost/?test=Test1%20%26%20Test2'"

		const value = await app.handle(new Request(url)).then((x) => x.json())

		expect(value).toEqual({
			query: {
				test: "Test1 & Test2'"
			},
			url: {
				test: new URL(url).searchParams.get('test')
			}
		})
	})

	it('handle array string correctly', async () => {
		const app = new Elysia({ precompile: true }).get(
			'/',
			({ query }) => query,
			{
				query: t.Object({
					status: t.Optional(t.Array(t.String()))
				})
			}
		)

		const response = await Promise.all([
			app.handle(req('/?')).then((x) => x.json()),
			app.handle(req('/?status=a')).then((x) => x.json()),
			app.handle(req('/?status=a&status=b')).then((x) => x.json())
		])

		expect(response).toEqual([
			{},
			{ status: ['a'] },
			{ status: ['a', 'b'] }
		])
	})

	it('handle Transform query', async () => {
		const app = new Elysia().get(
			'/test',
			({ query: { id } }) => ({
				id,
				type: typeof id
			}),
			{
				query: t.Object({
					id: t
						.Transform(t.Array(t.UnionEnum(['test', 'foo'])))
						.Decode((id) => ({ value: id }))
						.Encode((id) => id.value)
				})
			}
		)

		const response = await app
			.handle(req('/test?id=test'))
			.then((x) => x.json())

		expect(response).toEqual({
			id: {
				value: ['test']
			},
			type: 'object'
		})
	})

	it('handle Date query', async () => {
		const app = new Elysia().get(
			'/',
			({ query: { date } }) => date.toISOString(),
			{
				query: t.Object({
					date: t.Date()
				})
			}
		)

		const response = await app
			.handle(req(`/?date=2023-04-05T12:30:00+01:00`))
			.then((x) => x.text())

		expect(response).toEqual('2023-04-05T11:30:00.000Z')
	})

	it('handle coerce TransformDecodeError', async () => {
		let err: Error | undefined

		const app = new Elysia()
			.get('/', ({ query }) => query, {
				query: t.Object({
					year: t.Numeric({ minimum: 1900, maximum: 2160 })
				}),
				error({ code, error }) {
					switch (code) {
						case 'VALIDATION':
							err = error
					}
				}
			})
			.listen(0)

		await app.handle(req('?year=3000'))

		expect(err instanceof ValidationError).toBe(true)
	})

	it('handle reference query array', async () => {
		const app = new Elysia()
			.model({
				ids: t.Object({
					ids: t.Array(t.Union([t.String(), t.ArrayString()]))
				})
			})
			.get('/', ({ query }) => query, {
				query: 'ids'
			})

		const response = await app
			.handle(req('?ids=1,2,3'))
			.then((x) => x.json())

		expect(response).toEqual({
			ids: ['1', '2', '3']
		})
	})

	it('validate url encoded query', () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				test: t.Optional(t.Number()),
				$test: t.Optional(t.Number())
			})
		})

		const value = app
			.handle(new Request('http://localhost?test=1&%24test=2'))
			.then((x) => x.json())

		expect(value).resolves.toEqual({
			test: 1,
			$test: 2
		})
	})
})
