import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../src'

const req = (path: string) => new Request(path)

describe('inject', () => {
	it('work', async () => {
		const app = new Elysia()
			.inject(() => ({
				hi: () => 'hi'
			}))
			.get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('inherits plugin', async () => {
		const plugin = () => (app: Elysia) =>
			app.inject(() => ({
				hi: () => 'hi'
			}))

		const app = new Elysia().use(plugin()).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('can mutate store', async () => {
		const app = new Elysia()
			.state('counter', 1)
			.inject(({ store }) => ({
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
