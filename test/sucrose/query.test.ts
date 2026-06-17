import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string = '/?name=sucrose') =>
	new Request(`http://localhost${path}`)

describe('Query', () => {
	it('access all using property name', async () => {
		const app = new Elysia().get('/', (ctx) => ctx.query)
		const response = await app.handle(req())

		await expect(response.json()).resolves.toEqual({ name: 'sucrose' })
	})

	it('access all using destructuring', async () => {
		const app = new Elysia().get('/', ({ query }) => query)
		const response = await app.handle(req())

		await expect(response.json()).resolves.toEqual({ name: 'sucrose' })
	})

	it('access single param using property name', async () => {
		const app = new Elysia().get('/', (ctx) => ctx.query.name)
		const response = await app.handle(req())

		await expect(response.text()).resolves.toEqual('sucrose')
	})

	// Regression (audit P8): sucrose's access regex only matched `ctx.query`
	// (and bracket forms), not optional chaining `ctx?.query`. A handler using
	// optional chaining therefore didn't infer query usage, so it was never
	// parsed and read back undefined at runtime.
	it('access via optional chaining (ctx?.query)', async () => {
		const app = new Elysia().get('/', (ctx) => ctx?.query?.name ?? 'MISS')
		const response = await app.handle(req())

		await expect(response.text()).resolves.toEqual('sucrose')
	})

	it('access single param using destructuring', async () => {
		const app = new Elysia().get('/', ({ query: { name } }) => name)
		const response = await app.handle(req())

		await expect(response.text()).resolves.toEqual('sucrose')
	})

	it('access all using destructuring assignment', async () => {
		const app = new Elysia().get('/', (ctx) => {
			const { query } = ctx
			return query
		})
		const response = await app.handle(req())

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
		const response = await app.handle(req())

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

		const response = await app.handle(req())

		await expect(response.json()).resolves.toEqual({ name: 'sucrose' })
	})

	it('destructured encoded & (%26) query string', async () => {
		const app = new Elysia()
			.get('/unknown', ({ query }) => query)
			.get('/named', ({ query: { name } }) => name)

		const unknown = await app
			.handle(req('/unknown?name=sucrose%26albedo&alias=achemist'))
			.then((x) => x.json())
		const named = await app
			.handle(req('/named?name=sucrose%26albedo&alias=achemist'))
			.then((x) => x.text())

		expect(unknown).toEqual({ name: 'sucrose&albedo', alias: 'achemist' })
		expect(named).toEqual('sucrose&albedo')
	})
})
