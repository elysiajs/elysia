import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { req } from '../utils'

const scoped = new Elysia({
	name: 'scoped',
	scoped: true
})
	.state('inner', 0)
	.state('outer', 0)
	.get('/scoped', ({ store }) => ({
		outer: store.outer,
		inner: ++store.inner
	}))

describe('Scoped', () => {
	it('sync store', async () => {
		const app = new Elysia()
			.state('outer', 0)
			.use(scoped)
			.get('/', ({ store }) => ++store.outer)

		expect(await app.handle(req('/')).then((x) => x.text())).toBe('1')
		expect(await app.handle(req('/scoped')).then((x) => x.json())).toEqual({
			outer: 1,
			inner: 1
		})
		expect(await app.handle(req('/')).then((x) => x.text())).toBe('2')
	})

	it('encapsulate request event', async () => {
		let count = 0

		const scoped = new Elysia({
			name: 'scoped',
			scoped: true
		})
			.onRequest(() => {
				count++
			})
			.get('/scoped', () => 'A')

		const app = new Elysia().use(scoped).get('/', () => 'A')

		await app.handle(req('/'))
		await app.handle(req('/scoped'))

		expect(count).toBe(1)
	})

	it('encapsulate afterhandle event', async () => {
		let count = 0

		const scoped = new Elysia({
			name: 'scoped',
			scoped: true
		})
			.onAfterHandle(() => {
				count++
			})
			.get('/scoped', () => 'A')

		const app = new Elysia().use(scoped).get('/', () => 'A')

		await app.handle(req('/'))
		await app.handle(req('/scoped'))

		expect(count).toBe(1)
	})
})
