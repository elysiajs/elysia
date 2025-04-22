/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('Decorate', () => {
	it('decorate primitive', async () => {
		const app = new Elysia()
			.decorate('name', 'Ina')
			.decorate('name', 'Tako')

		expect(app.decorator.name).toBe('Ina')
	})

	it('decorate multiple', async () => {
		const app = new Elysia()
			.decorate('name', 'Ina')
			.decorate('job', 'artist')

		expect(app.decorator).toEqual({
			name: 'Ina',
			job: 'artist'
		})
	})

	it('decorate object', async () => {
		const app = new Elysia()
			.decorate({
				name: 'Ina',
				job: 'artist'
			})
			.decorate({ as: 'override' }, {
				name: 'Fubuki'
			})

		expect(app.decorator).toEqual({
			name: 'Fubuki',
			job: 'artist'
		})
	})

	it('remap object', async () => {
		const app = new Elysia()
			.decorate({
				name: 'Ina',
				job: 'artist'
			})
			.decorate(({ job, ...rest }) => ({
				...rest,
				job: 'streamer'
			}))

		expect(app.decorator).toEqual({
			name: 'Ina',
			job: 'streamer'
		})
	})

	it('inherits functional plugin', async () => {
		const plugin = () => (app: Elysia) => app.decorate('hi', () => 'hi')

		const app = new Elysia().use(plugin()).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().decorate('hi', () => 'hi')

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('accepts any type', async () => {
		const app = new Elysia().decorate('hi', {
			there: {
				hello: 'world'
			}
		})

		expect(app.decorator.hi.there.hello).toBe('world')
	})

	it('remap', async () => {
		const app = new Elysia()
			.decorate('job', 'artist')
			.decorate('name', 'Ina')
			.decorate(({ job, ...decorators }) => ({
				...decorators,
				job: 'vtuber'
			}))

		expect(app.decorator.job).toBe('vtuber')
	})

	it('handle class deduplication', async () => {
		let _i = 0

		class A {
			public i: number

			constructor() {
				this.i = _i++
			}
		}

		const app = new Elysia().decorate('a', new A()).decorate('a', new A())

		expect(app.decorator.a.i).toBe(0)
	})

	it('handle nested object deduplication', async () => {
		const app = new Elysia()
			.decorate('a', {
				hello: {
					world: 'Tako'
				}
			})
			.decorate('a', {
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			})

		expect(app.decorator).toEqual({
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
			.decorate('name', 'Ina')
			.decorate({ as: 'override' }, 'name', 'Tako')

		expect(app.decorator.name).toBe('Tako')
	})

	it('override object', async () => {
		const app = new Elysia()
			.decorate({
				name: 'Ina',
				job: 'artist'
			})
			.decorate(
				{ as: 'override' },
				{
					name: 'Fubuki'
				}
			)

		expect(app.decorator).toEqual({
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
			.decorate('a', new A())
			.decorate({ as: 'override' }, 'a', new A())

		expect(app.decorator.a.i).toBe(1)
	})

	it('override nested object deduplication using name', async () => {
		const app = new Elysia()
			.decorate('a', {
				hello: {
					world: 'Tako'
				}
			})
			.decorate({ as: 'override' }, 'a', {
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			})

		expect(app.decorator.a.hello).toEqual({
			world: 'Ina',
			cookie: 'wah!'
		})
	})

	it('override nested object deduplication using value', async () => {
		const app = new Elysia()
			.decorate({
				hello: {
					world: 'Tako'
				}
			})
			.decorate(
				{ as: 'override' },
				{
					hello: {
						world: 'Ina',
						cookie: 'wah!'
					}
				}
			)

		expect(app.decorator.hello).toEqual({
			world: 'Ina',
			cookie: 'wah!'
		})
	})

	it('handle escaped name', async () => {
		const app = new Elysia()
			.decorate('name ina', 'Ina')

		expect(app.decorator['name ina']).toBe('Ina')
	})
})
