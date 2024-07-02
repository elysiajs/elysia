/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('State', () => {
	it('decorate primitive', async () => {
		const app = new Elysia().state('name', 'Ina').state('name', 'Tako')

		expect(app.store.name).toBe('Ina')
	})

	it('decorate multiple', async () => {
		const app = new Elysia().state('name', 'Ina').state('job', 'artist')

		expect(app.store).toEqual({
			name: 'Ina',
			job: 'artist'
		})
	})

	it('decorate object', async () => {
		const app = new Elysia()
			.state({
				name: 'Ina',
				job: 'artist'
			})
			.state({
				name: 'Fubuki'
			})

		expect(app.store).toEqual({
			name: 'Ina',
			job: 'artist'
		})
	})

	it('remap object', async () => {
		const app = new Elysia()
			.state({
				name: 'Ina',
				job: 'artist'
			})
			.state(({ job, ...rest }) => ({
				...rest,
				job: 'streamer'
			}))

		expect(app.store).toEqual({
			name: 'Ina',
			job: 'streamer'
		})
	})

	it('inherits functional plugin', async () => {
		const plugin = () => (app: Elysia) => app.state('hi', () => 'hi')

		const app = new Elysia()
			.use(plugin())
			.get('/', ({ store: { hi } }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().state('hi', () => 'hi')

		const app = new Elysia()
			.use(plugin)
			.get('/', ({ store: { hi } }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('accepts any type', async () => {
		const app = new Elysia().state('hi', {
			there: {
				hello: 'world'
			}
		})

		expect(app.store.hi.there.hello).toBe('world')
	})

	it('remap', async () => {
		const app = new Elysia()
			.state('job', 'artist')
			.state('name', 'Ina')
			.state(({ job, ...decorators }) => ({
				...decorators,
				job: 'vtuber'
			}))

		expect(app.store.job).toBe('vtuber')
	})

	it('handle class deduplication', async () => {
		let _i = 0

		class A {
			public i: number

			constructor() {
				this.i = _i++
			}
		}

		const app = new Elysia().state('a', new A()).state('a', new A())

		expect(app.store.a.i).toBe(0)
	})

	it('handle nested object deduplication', async () => {
		const app = new Elysia()
			.state('a', {
				hello: {
					world: 'Tako'
				}
			})
			.state('a', {
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			})

		expect(app.store).toEqual({
			a: {
				hello: {
					world: 'Tako',
					cookie: 'wah!'
				}
			}
		})
	})

	it('override primitive', async () => {
		const app = new Elysia()
			.state('name', 'Ina')
			.state({ as: 'override' }, 'name', 'Tako')

		expect(app.store.name).toBe('Tako')
	})

	it('override object', async () => {
		const app = new Elysia()
			.state({
				name: 'Ina',
				job: 'artist'
			})
			.state(
				{ as: 'override' },
				{
					name: 'Fubuki'
				}
			)

		expect(app.store).toEqual({
			name: 'Fubuki',
			job: 'artist'
		})
	})

	it('override handle class', async () => {
		let _i = 0

		class A {
			public i: number

			constructor() {
				this.i = _i++
			}
		}

		const app = new Elysia()
			.state('a', new A())
			.state({ as: 'override' }, 'a', new A())

		expect(app.store.a.i).toBe(1)
	})

	it('override nested object deduplication using name', async () => {
		const app = new Elysia()
			.state('a', {
				hello: {
					world: 'Tako'
				}
			})
			.state({ as: 'override' }, 'a', {
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			})

		expect(app.store.a.hello).toEqual({
			world: 'Ina',
			cookie: 'wah!'
		})
	})

	it('override nested object deduplication using value', async () => {
		const app = new Elysia()
			.state({
				hello: {
					world: 'Tako'
				}
			})
			.state(
				{ as: 'override' },
				{
					hello: {
						world: 'Ina',
						cookie: 'wah!'
					}
				}
			)

		expect(app.store.hello).toEqual({
			world: 'Ina',
			cookie: 'wah!'
		})
	})
})
