import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('Derive', () => {
	it('derive', async () => {
		const app = new Elysia()
			.state('counter', 1)
			.derive((getStore) => ({
				doubled: () => getStore().counter * 2
			}))
			.get('/', ({ store: { counter, doubled } }) => ({
				counter,
				doubled: doubled()
			}))

		const res = await app.handle(req('/')).then((r) => r.text())

		expect(res).toBe(
			JSON.stringify({
				counter: 1,
				doubled: 2
			})
		)
	})

	it('reactivity', async () => {
		const app = new Elysia()
			.state('counter', 1)
			.derive((getStore) => ({
				doubled: () => getStore().counter * 2,
				tripled: () => getStore().counter * 3
			}))
			.inject(({ store }) => ({
				increase() {
					store.counter++
				}
			}))
			.get('/', ({ increase, store }) => {
				store.counter++
				increase()

				const { counter, doubled, tripled } = store

				return {
					counter,
					doubled: doubled(),
					tripled: tripled()
				}
			})

		await Promise.all([app.handle(req('/')), app.handle(req('/'))])

		const res = await app.handle(req('/'))
		const result = await res.text()

		expect(result).toBe(
			JSON.stringify({
				counter: 7,
				doubled: 14,
				tripled: 21
			})
		)
	})

	it('from plugin', async () => {
		const plugin = () => (app: Elysia) =>
			app.state('counter', 1).derive((getStore) => ({
				doubled: () => getStore().counter * 2,
				tripled: () => getStore().counter * 3
			}))

		const app = new Elysia()
			.use(plugin())
			.inject(({ store }) => ({
				increase() {
					store.counter++
				}
			}))
			.get('/', ({ increase, store }) => {
				store.counter++
				increase()

				const { counter, doubled, tripled } = store

				return {
					counter,
					doubled: doubled(),
					tripled: tripled()
				}
			})

		await Promise.all([app.handle(req('/')), app.handle(req('/'))])

		const res = await app.handle(req('/'))
		const result = await res.text()

		expect(result).toBe(
			JSON.stringify({
				counter: 7,
				doubled: 14,
				tripled: 21
			})
		)
	})
})
