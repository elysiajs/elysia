import { Context, Elysia, t } from '../../src'

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

		// console.log(app.routes[0].composed?.toString())

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
		console.log(url.href) //http://localhost:3000/?keyword=hello+world

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

		const response = await Promise.all(
			[
				'/?key1=ab&key1=cd&z=が',
				'/?key1=ab&z=が',
				'/?key1=ab&key1=cd&z=x',
				'/?z=が&key1=ab&key1=cd',
				'/?key1=で&key1=が&z=x'
			].map((path) => app.handle(req(path)).then((x) => x.status))
		).then((responses) => responses.every((status) => status === 200))

		expect(response).toBeTrue()
	})

	// https://github.com/elysiajs/elysia/issues/912
	it('handle JavaScript date numeric offset', () => {
		const api = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				date: t.Date()
			})
		})

		api.handle(req(`/?date=${Date.now()}`))
			.then((x) => x.json())
			.then(console.log)
	})
})
