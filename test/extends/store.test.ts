import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('State', () => {
	it('store primitive', async () => {
		const app = new Elysia()
			.state('name', 'Ina')
			.get('/', ({ store }) => store)

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual({
			name: 'Ina'
		})
	})

	it('store multiple', async () => {
		const app = new Elysia()
			.state('name', 'Ina')
			.state('job', 'artist')
			.get('/', ({ store }) => store)

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual({
			name: 'Ina',
			job: 'artist'
		})
	})

	it('store object', async () => {
		const app = new Elysia()
			.state({
				name: 'Ina',
				job: 'artist'
			})
			.get('/', ({ store }) => store)

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual({
			name: 'Ina',
			job: 'artist'
		})
	})

	it('inherits function plugin', async () => {
		const plugin = () => (app: Elysia) => app.state('hi', () => 'hi')

		const app = new Elysia()
			.use(plugin())
			.get('/', ({ store: { hi } }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().state('name', 'Ina')
		const app = new Elysia().use(plugin).get('/', ({ store }) => store)

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual({
			name: 'Ina'
		})
	})

	it('accepts any type', async () => {
		const app = new Elysia()
			.state('hi', {
				there: {
					hello: 'world'
				}
			})
			.get('/', ({ store: { hi } }) => hi.there.hello)

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('world')
	})

	it('remap', async () => {
		const app = new Elysia()
			.state('job', 'artist')
			.state('name', 'Ina')
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			.state(({ job, ...state }) => ({
				...state,
				job: 'vtuber'
			}))
			.get('/', ({ store: { job } }) => job)

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('vtuber')
	})
})
