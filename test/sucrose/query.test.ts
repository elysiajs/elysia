import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string = '/?name=sucrose') =>
	new Request(`http://localhost${path}`)

describe('Query', () => {
	it('access all using property name', async () => {
		const app = new Elysia().get('/', (ctx) => ctx.query)
		const response = await app.handle('/?name=sucrose')

		await expect(response.json()).resolves.toEqual({ name: 'sucrose' })
	})

	it('access all using destructuring', async () => {
		const app = new Elysia().get('/', ({ query }) => query)
		const response = await app.handle('/?name=sucrose')

		await expect(response.json()).resolves.toEqual({ name: 'sucrose' })
	})

	it('access single param using property name', async () => {
		const app = new Elysia().get('/', (ctx) => ctx.query.name)
		const response = await app.handle('/?name=sucrose')

		await expect(response.text()).resolves.toEqual('sucrose')
	})

	// Optional chaining must still initialize and parse the query.
	it('access via optional chaining (ctx?.query)', async () => {
		const app = new Elysia().get('/', (ctx) => ctx?.query?.name ?? 'MISS')
		const response = await app.handle('/?name=sucrose')

		await expect(response.text()).resolves.toEqual('sucrose')
	})

	it('access single param using destructuring', async () => {
		const app = new Elysia().get('/', ({ query: { name } }) => name)
		const response = await app.handle('/?name=sucrose')

		await expect(response.text()).resolves.toEqual('sucrose')
	})

	it('access all using destructuring assignment', async () => {
		const app = new Elysia().get('/', (ctx) => {
			const { query } = ctx
			return query
		})
		const response = await app.handle('/?name=sucrose')

		await expect(response.json()).resolves.toEqual({ name: 'sucrose' })
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
		const response = await app.handle('/?name=sucrose')

		await expect(response.json()).resolves.toEqual({ name: 'sucrose' })
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

		const response = await app.handle('/?name=sucrose')

		await expect(response.json()).resolves.toEqual({ name: 'sucrose' })
	})

	it('destructured encoded & (%26) query string', async () => {
		const app = new Elysia()
			.get('/unknown', ({ query }) => query)
			.get('/named', ({ query: { name } }) => name)

		const unknown = await app
			.handle('/unknown?name=sucrose%26albedo&alias=achemist')
			.then((x) => x.json())
		const named = await app
			.handle('/named?name=sucrose%26albedo&alias=achemist')
			.then((x) => x.text())

		expect(unknown).toEqual({ name: 'sucrose&albedo', alias: 'achemist' })
		expect(named).toEqual('sucrose&albedo')
	})
})
