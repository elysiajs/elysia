import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('Elysia', () => {
	it('handle state', async () => {
		const app = new Elysia()
			.state('a', 'a')
			.get('/', ({ store: { a } }) => a)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('a')
	})

	// https://github.com/oven-sh/bun/issues/1523
	it("don't return HTTP 10", async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers.Server = 'Elysia'

			return 'hi'
		})

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
	})

	it('has no side-effect', async () => {
		const app = new Elysia()
			.get('/1', ({ set }) => {
				set.headers['x-server'] = 'Elysia'

				return 'hi'
			})
			.get('/2', () => 'hi')

		const res1 = await app.handle(req('/1'))
		const res2 = await app.handle(req('/2'))

		expect(res1.headers.get('x-server')).toBe('Elysia')
		expect(res2.headers.get('x-server')).toBe(null)
	})

	it('return Promise', async () => {
		const app = new Elysia().get(
			'/',
			() => new Promise((resolve) => resolve('h'))
		)

		const res = await app.handle(req('/')).then((x) => x.text())
		expect(res).toBe('h')
	})

	it('handle dynamic all method', async () => {
		const app = new Elysia().all('/all/*', () => 'ALL')

		const res = await app.handle(req('/all/world')).then((x) => x.text())
		expect(res).toBe('ALL')
	})

	it('handle object of class', async () => {
		class SomeResponse {
			constructor(public message: string) {}
		}

		const app = new Elysia().get(
			'/',
			() => new SomeResponse('Hello, world!')
		)

		const res = await app.handle(req('/')).then((x) => x.json())
		expect(res).toStrictEqual({
			message: 'Hello, world!'
		})
	})

	it('handle object of class (async)', async () => {
		class SomeResponse {
			constructor(public message: string) {}
		}

		const app = new Elysia().get(
			'/',
			async () => {
				await Bun.sleep(1)
				return new SomeResponse('Hello, world!')
			}
		)

		const res = await app.handle(req('/')).then((x) => x.json())
		expect(res).toStrictEqual({
			message: 'Hello, world!'
		})
	})
})
