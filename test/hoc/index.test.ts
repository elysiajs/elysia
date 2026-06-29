/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('HOC', () => {
	it('work', async () => {
		let called = 0

		const app = new Elysia()
			.wrap((fn) => {
				called++

				return fn
			})
			.get('/', () => 'ok')

		await app.handle(req('/'))

		expect(called).toBe(1)
	})

	it('runs before the handler and can short-circuit', async () => {
		let handlerRan = false

		const app = new Elysia()
			.wrap((fn) => (request) => new Response('intercepted'))
			.get('/', () => {
				handlerRan = true
				return 'ok'
			})

		const response = await app.handle(req('/'))

		await expect(response.text()).resolves.toBe('intercepted')
		expect(handlerRan).toBe(false)
	})

	it('can transform the response', async () => {
		const app = new Elysia()
			.wrap((fn) => async (request) => {
				const response = await fn(request)
				return new Response((await response.text()) + '!')
			})
			.get('/', () => 'ok')

		const response = await app.handle(req('/'))

		await expect(response.text()).resolves.toBe('ok!')
	})

	it('applies the first-registered wrap as the outermost layer', async () => {
		const order: string[] = []

		const app = new Elysia()
			.wrap((fn) => async (request) => {
				order.push('A in')
				const response = await fn(request)
				order.push('A out')
				return response
			})
			.wrap((fn) => async (request) => {
				order.push('B in')
				const response = await fn(request)
				order.push('B out')
				return response
			})
			.get('/', () => 'ok')

		await app.handle(req('/'))

		// First-registered = outermost: A wraps B wraps the handler.
		expect(order).toEqual(['A in', 'B in', 'B out', 'A out'])
	})

	it('forwards extra fetch args (e.g. server / env) to the wrap', async () => {
		let seen: unknown

		const app = new Elysia()
			.wrap((fn) => (request, ...rest) => {
				seen = rest[0]
				return fn(request, ...rest)
			})
			.get('/', () => 'ok')

		const server = { id: 'server' }
		// `app.fetch` is the adapter-facing entry; Bun calls it as
		// `(request, server)`, Cloudflare as `(request, env, ctx)`.
		await app.fetch(req('/'), server as any)

		expect(seen).toBe(server)
	})

	it("applies a plugin's wrap to the host", async () => {
		let wrapped = false

		const plugin = new Elysia({ name: 'plugin' }).wrap(
			(fn) => (request) => {
				wrapped = true
				return fn(request)
			}
		)

		const app = new Elysia().use(plugin).get('/', () => 'ok')

		await app.handle(req('/'))

		expect(wrapped).toBe(true)
	})

	it('deduplicate', async () => {
		const plugin = new Elysia().wrap((fn) => fn)
		const plugin2 = new Elysia({ name: 'plugin2' }).wrap((fn) => fn)

		const app = new Elysia()
			.use(plugin)
			.use(plugin)
			.use(plugin)
			.use(plugin2)
			.use(plugin2)
			.get('/', () => 'ok')

		expect(app['~ext']?.hoc?.length).toBe(2)
	})

	it('applies a reused plugin wrap only once per request', async () => {
		let calls = 0

		const plugin = new Elysia().wrap((fn) => (request) => {
			calls++
			return fn(request)
		})

		const app = new Elysia()
			.use(plugin)
			.use(plugin)
			.use(plugin)
			.get('/', () => 'ok')

		await app.handle(req('/'))

		expect(calls).toBe(1)
	})
})
