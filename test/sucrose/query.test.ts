import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

const req = () => new Request(`http://localhost/?name=sucrose`)

describe('Query', () => {
	it('access all using property name', async () => {
		const app = new Elysia().get('/', (ctx) => ctx.query)
		const response = await app.handle(req())

		expect(await response.json()).toEqual({ name: 'sucrose' })
	})

	it('access all using destructuring', async () => {
		const app = new Elysia().get('/', ({ query }) => query)
		const response = await app.handle(req())

		expect(await response.json()).toEqual({ name: 'sucrose' })
	})

	it('access single param using property name', async () => {
		const app = new Elysia().get('/', (ctx) => ctx.query.name)
		const response = await app.handle(req())

		expect(await response.text()).toEqual('sucrose')
	})

	it('access single param using destructuring', async () => {
		const app = new Elysia().get('/', ({ query: { name } }) => name)
		const response = await app.handle(req())

		expect(await response.text()).toEqual('sucrose')
	})

	it('access all using destructuring assignment', async () => {
		const app = new Elysia().get('/', (ctx) => {
			const { query } = ctx
			return query
		})
		const response = await app.handle(req())

		expect(await response.json()).toEqual({ name: 'sucrose' })
	})

	it('access all using destructuring assignment within derive', async () => {
		const app = new Elysia()
			.derive((ctx) => {
				const { query } = ctx
				return {
					yay() {
						return query
					}
				}
			})
			.get('/', (ctx) => ctx.yay())
		const response = await app.handle(req())

		expect(await response.json()).toEqual({ name: 'sucrose' })
	})

	it('access all using property name within derive', async () => {
		const app = new Elysia()
			.derive((ctx) => {
				return {
					yay() {
						return ctx.query
					}
				}
			})
			.get('/', (ctx) => ctx.yay())
		const response = await app.handle(req())

		expect(await response.json()).toEqual({ name: 'sucrose' })
	})
})
