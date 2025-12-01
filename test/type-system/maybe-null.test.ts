import { describe, expect, it } from 'bun:test'
import Elysia, { t } from '../../src'
import { post } from '../utils'

describe('TypeSystem - MaybeNull', () => {
	it('OpenAPI compliant', () => {
		const schema = t.MaybeNull(t.String())

		expect(schema).toMatchObject({
			type: 'string',
			nullable: true
		})

		const objSchema = t.Object({
			name: t.MaybeNull(t.String())
		})

		expect(objSchema).toMatchObject({
			type: 'object',
			properties: {
				name: {
					type: 'string',
					nullable: true
				}
			}
		})

		const schema1 = t.MaybeNull(
			t.Object({
				a: t.String(),
				b: t.Number()
			})
		)

		expect(schema1).toMatchObject({
			type: 'object',
			properties: {
				a: {
					type: 'string'
				},
				b: {
					type: 'number'
				}
			},
			nullable: true
		})
	})

	it('Validates primitive values', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.MaybeNull(t.String())
			})
		})

		const res1 = await app.handle(
			post('/', {
				name: '123'
			})
		)
		expect(res1.status).toBe(200)
		expect(await res1.json()).toEqual({ name: '123' })

		const res2 = await app.handle(
			post('/', {
				name: null
			})
		)

		expect(res2.status).toBe(200)
		expect(await res2.json()).toEqual({ name: null })

		const res3 = await app.handle(post('/', {}))
		expect(res3.status).toBe(422)

		const res4 = await app.handle(
			post('/', {
				name: 123
			})
		)

		expect(res4.status).toBe(422)

		const res5 = await app.handle(
			post('/', {
				name: ''
			})
		)
		expect(res5.status).toBe(200)
		expect(await res5.json()).toEqual({ name: '' })

		const app1 = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.MaybeNull(t.Number())
			})
		})

		const res6 = await app1.handle(
			post('/', {
				name: '123'
			})
		)

		expect(res6.status).toBe(422)

		const res7 = await app1.handle(
			post('/', {
				name: 123
			})
		)

		expect(res7.status).toBe(200)
		expect(await res7.json()).toEqual({ name: 123 })
	})

	it('Validates objects', async () => {
		const appWithArray = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.Object({
					value: t.MaybeNull(t.Array(t.Number()))
				})
			})
		})

		const res1 = await appWithArray.handle(
			post('/', {
				name: {
					value: [1, 2, 3]
				}
			})
		)

		expect(res1.status).toBe(200)
		expect(await res1.json()).toEqual({ name: { value: [1, 2, 3] } })

		const res2 = await appWithArray.handle(
			post('/', {
				name: {
					value: 'failable'
				}
			})
		)

		expect(res2.status).toBe(422)

		const res3 = await appWithArray.handle(
			post('/', {
				name: {
					value: ['1', '2', '3']
				}
			})
		)

		expect(res3.status).toBe(422)

		const appWithObj = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.MaybeNull(
					t.Object({
						a: t.String(),
						b: t.Number(),
						c: t.Boolean()
					})
				)
			})
		})

		const res4 = await appWithObj.handle(
			post('/', {
				name: {
					a: '1',
					b: 2,
					c: true
				}
			})
		)

		expect(res4.status).toBe(200)
		expect(await res4.json()).toEqual({ name: { a: '1', b: 2, c: true } })

		const res5 = await appWithObj.handle(
			post('/', {
				name: {
					a: '1',
					b: '2',
					c: true
				}
			})
		)

		expect(res5.status).toBe(422)

		const res6 = await appWithObj.handle(
			post('/', {
				name: 'abc'
			})
		)

		expect(res6.status).toBe(422)

		const res7 = await appWithObj.handle(
			post('/', {
				name: null
			})
		)

		expect(res7.status).toBe(200)
		expect(await res7.json()).toEqual({ name: null })

		const res8 = await appWithObj.handle(
			post('/', {})
		)

		expect(res8.status).toBe(422)
	})
})
