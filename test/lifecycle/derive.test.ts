import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('derive', () => {
	it('adds returned fields to the request context', async () => {
		const app = new Elysia()
			.derive(() => ({
				hi: () => 'hi'
			}))
			.get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('propagates global derives through plugins', async () => {
		const plugin = new Elysia().derive('global', () => ({
			hi: () => 'hi'
		}))

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('does not propagate local derives out of plugins', async () => {
		const plugin = new Elysia().derive(() => ({
			hi: () => 'hi'
		}))

		const app = new Elysia()
			.use(plugin)
			// @ts-expect-error
			.get('/', ({ hi }) => typeof hi === 'undefined')

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('true')
	})

	it('runs derives in registration order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.derive(() => {
				order.push('A')
				return {}
			})
			.derive(() => {
				order.push('B')
				return {}
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('can expose a helper that mutates the store', async () => {
		const app = new Elysia()
			.state('counter', 1)
			.derive(({ store }) => ({
				increase: () => store.counter++
			}))
			.get('/', ({ store, increase }) => {
				increase()

				return store.counter
			})

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('2')
	})

	it('can read a destructured request header', async () => {
		const app = new Elysia()
			.derive(({ headers: { name } }) => ({
				name
			}))
			.get('/', ({ name }) => name)

		const res = await app
			.handle(
				new Request('http://localhost/', {
					headers: {
						name: 'Elysia'
					}
				})
			)
			.then((t) => t.text())

		expect(res).toBe('Elysia')
	})

	it('runs between app and route-local beforeHandle hooks', async () => {
		const order: string[] = []

		const app = new Elysia()
			.beforeHandle(() => {
				order.push('app beforeHandle')
			})
			.derive(() => {
				order.push('derive')

				return { name: 'Ina' }
			})
			.get(
				'/',
				{
					beforeHandle() {
						order.push('route beforeHandle')
					}
				},
				({ name }) => name
			)

		await app.handle(req('/'))

		expect(order).toEqual([
			'app beforeHandle',
			'derive',
			'route beforeHandle'
		])
	})

	it('runs a global derive on plugin and parent routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.derive('global', ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('runs a local derive only on routes declared by its plugin', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.derive('local', ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner'])
	})

	it('runs a plugin-scoped derive through one composition level', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.derive('plugin', ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => 'NOOP')

		const middle = new Elysia().use(plugin).get('/middle', () => 'NOOP')

		const app = new Elysia().use(middle).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/middle')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/middle'])
	})

	it('uses a status returned from derive as the response', async () => {
		const app = new Elysia()
			.derive(({ status }) => status(418))
			.get('/', () => '')

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toEqual("I'm a teapot")
	})

	it('does not send a status returned from derive through the error hook', async () => {
		let isOnErrorCalled = false

		const app = new Elysia()
			.error(() => {
				isOnErrorCalled = true
			})
			.derive(({ status }) => status(418))
			.get('/', () => '')

		await app.handle(req('/'))

		expect(isOnErrorCalled).toBe(false)
	})

	it('preserves a status returned from derive through plugin composition', async () => {
		const route = new Elysia()
			.derive(({ status }) => status(418))
			.get('/', () => '')

		const response = await new Elysia().use(route).handle(req('/'))

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe("I'm a teapot")
	})
})
