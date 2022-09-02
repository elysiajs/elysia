import KingWorld from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('KingWorld', () => {
	it('state', async () => {
		const app = new KingWorld().state('a', 'a').get('/', (_, { a }) => a)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('a')
	})

	it('ref', async () => {
		const app = new KingWorld().ref('a', 'a').get('/', (_, { a }) => a)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('a')
	})

	it('ref fn', async () => {
		const app = new KingWorld()
			.ref('a', () => 'a')
			.get('/', (_, { a }) => a)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('a')
	})

	it('ref async', async () => {
		const app = new KingWorld()
			.ref('a', async () => new Promise((resolve) => resolve('a')))
			.get('/', (_, { a }) => a)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('a')
	})
})
