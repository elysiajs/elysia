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
