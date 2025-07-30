import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req, delay } from '../utils'

describe('On Request', () => {
	it('inject headers to response', async () => {
		const app = new Elysia()
			.onRequest(({ set }) => {
				set.headers['Access-Control-Allow-Origin'] = '*'
			})
			.get('/', () => 'hi')

		const res = await app.handle(req('/'))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
	})

	it('handle async', async () => {
		const app = new Elysia()
			.onRequest(async ({ set }) => {
				await delay(5)
				set.headers.name = 'llama'
			})
			.get('/', () => 'hi')

		const res = await app.handle(req('/'))

		expect(res.headers.get('name')).toBe('llama')
	})

	it('early return', async () => {
		const app = new Elysia()
			.onRequest(({ set }) => {
				set.status = 401
				return 'Unauthorized'
			})
			.get('/', () => {
				console.log("This shouldn't be run")
				return "You shouldn't see this"
			})

		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('Unauthorized')
		expect(res.status).toBe(401)
	})

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.onRequest([
				() => {
					total++
				},
				() => {
					total++
				}
			])
			.get('/', () => 'NOOP')

		const res = await app.handle(req('/'))

		expect(total).toEqual(2)
	})

	it('request in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.onRequest(() => {
				order.push('A')
			})
			.onRequest(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('has qi', async () => {
		let queryIndex

		const app = new Elysia()
			// @ts-ignore
			.onRequest(({ qi }) => {
				queryIndex = qi
			})
			.get('/', () => 'ok')
			.listen(0)

		await fetch(`http://localhost:${app.server?.port}`)

		expect(queryIndex).toBeTypeOf('number')
	})
})
