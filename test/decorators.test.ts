import { describe, it, expect } from 'bun:test'
import { Elysia } from '../src'
import { req } from './utils'

describe('decorators', () => {
	it('work', async () => {
		const app = new Elysia()
			.decorate('hi', () => 'hi')
			.get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('inherits plugin', async () => {
		const plugin = () => (app: Elysia) => app.decorate('hi', () => 'hi')

		const app = new Elysia().use(plugin()).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('accepts any type', async () => {
		const app = new Elysia()
			.decorate('hi', {
				there: {
					hello: 'world'
				}
			})
			.get('/', ({ hi }) => hi.there.hello)

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('world')
	})
})

describe('decorateOnRequest', () => {
	it('work', async () => {
		const app = new Elysia()
			.decorateOnRequest(() => ({
				hi: () => 'hi'
			}))
			.get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('inherits plugin', async () => {
		const plugin = () => (app: Elysia) =>
			app.decorateOnRequest(() => ({
				hi: () => 'hi'
			}))

		const app = new Elysia().use(plugin()).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('can mutate store', async () => {
		const app = new Elysia()
			.setStore('counter', 1)
			.decorateOnRequest(({ store }) => ({
				increase: () => store.counter++
			}))
			.get('/', ({ store, increase }) => {
				increase()

				return store.counter
			})

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('2')
	})
})
