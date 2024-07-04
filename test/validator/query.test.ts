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
		const app = new Elysia()
			.get('/', ({ query }) => query, {
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
		const app = new Elysia()
			.get('/', ({ query }) => query, {
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

	it('parse query array without schema', async () => {
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

	it("don't parse query object without schema", async () => {
		const app = new Elysia()
			.get('/', ({ query: { role } }) => role)

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
})
