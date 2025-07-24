import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('handle path with spaces', () => {
	it('AOT on: static path', async () => {
		const PATH = '/y a y'

		const app = new Elysia().get(
			PATH,
			() => 'result from a path wirh spaces'
		)

		const response = await app.handle(
			new Request(`http://localhost${PATH}`)
		)

		expect(response.status).toBe(200)
	})

	it('AOT off: static path', async () => {
		const PATH = '/y a y'

		const app = new Elysia({ aot: false }).get(
			PATH,
			() => 'result from a path wirh spaces'
		)

		const response = await app.handle(
			new Request(`http://localhost${PATH}`)
		)

		expect(response.status).toBe(200)
	})

	it('AOT on: dynamic path', async () => {
		const app = new Elysia().get('/y a y/:id', ({ params: { id } }) => id)

		const response = await app.handle(
			new Request(`http://localhost/y a y/1`)
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('1')
	})

	it('AOT off: dynamic path', async () => {
		const app = new Elysia({ aot: false }).get(
			'/y a y/:id',
			({ params: { id } }) => id
		)

		const response = await app.handle(
			new Request(`http://localhost/y a y/1`)
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('1')
	})

	it('AOT on: optional dynamic path', async () => {
		const app = new Elysia().get(
			'/y a y/:id?',
			({ params: { id } }) => id ?? 0
		)

		const response = await Promise.all(
			[
				new Request(`http://localhost/y a y`),
				new Request(`http://localhost/y a y/1`)
			].map(app.handle)
		)

		expect(response[0].status).toBe(200)
		expect(response[1].status).toBe(200)

		const value = await Promise.all(response.map((x) => x.text()))

		expect(value[0]).toBe('0')
		expect(value[1]).toBe('1')
	})

	it('AOT off: optional dynamic path', async () => {
		const app = new Elysia({ aot: false }).get(
			'/y a y/:id?',
			({ params: { id } }) => id ?? 0
		)

		const response = await Promise.all(
			[
				new Request(`http://localhost/y a y`),
				new Request(`http://localhost/y a y/1`)
			].map(app.handle)
		)

		expect(response[0].status).toBe(200)
		expect(response[1].status).toBe(200)

		const value = await Promise.all(response.map((x) => x.text()))

		expect(value[0]).toBe('0')
		expect(value[1]).toBe('1')
	})

	it('handle optional path parameters after required', async () => {
		const app = new Elysia().get(
			'/api/:required/:optional?',
			({ params }) => params.required
		)

		const required = await app.handle(
			new Request('http://localhost/api/yay')
		)

		expect(required.status).toBe(200)
		expect(await required.text()).toEqual('yay')

		const optional = await app.handle(
			new Request('http://localhost/api/yay/ok')
		)

		expect(optional.status).toBe(200)
		expect(await optional.text()).toEqual('yay')
	})
})
