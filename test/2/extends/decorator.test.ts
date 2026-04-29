/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../../src/2'
import { req } from '../../utils'

describe('Decorate', () => {
	it('decorate primitive', async () => {
		const app = new Elysia()
			.decorate('name', 'Ina')
			.decorate('name', 'Tako')

		expect(app['~ext']?.decorator?.name).toBe('Ina')
	})

	it('decorate multiple', async () => {
		const app = new Elysia()
			.decorate('name', 'Ina')
			.decorate('job', 'artist')

		expect(app['~ext']?.decorator).toEqual({
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
			.decorate('override', {
				name: 'Fubuki'
			})

		expect(app['~ext']?.decorator).toEqual({
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

		expect(app['~ext']?.decorator).toEqual({
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

		expect(app['~ext']?.decorator?.hi.there.hello).toBe('world')
	})

	it('remap', async () => {
		const app = new Elysia()
			.decorate('job', 'artist')
			.decorate('name', 'Ina')
			.decorate(({ job, ...decorators }) => ({
				...decorators,
				job: 'vtuber'
			}))

		expect(app['~ext']?.decorator?.job).toBe('vtuber')
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

		expect(app['~ext']?.decorator?.a.i).toBe(0)
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

		expect(app['~ext']?.decorator).toEqual({
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
			.decorate('override', 'name', 'Tako')

		expect(app['~ext']?.decorator?.name).toBe('Tako')
	})

	it('override object', async () => {
		const app = new Elysia()
			.decorate({
				name: 'Ina',
				job: 'artist'
			})
			.decorate('override', {
				name: 'Fubuki'
			})

		expect(app['~ext']?.decorator).toEqual({
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
			.decorate('override', 'a', new A())

		expect(app['~ext']?.decorator?.a.i).toBe(1)
	})

	it('override nested object deduplication using name', async () => {
		const app = new Elysia()
			.decorate('a', {
				hello: {
					world: 'Tako'
				}
			})
			.decorate('override', 'a', {
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			})

		expect(app['~ext']?.decorator?.a.hello).toEqual({
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
			.decorate('override', {
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			})

		expect(app['~ext']?.decorator?.hello).toEqual({
			world: 'Ina',
			cookie: 'wah!'
		})
	})

	it('handle escaped name', async () => {
		const app = new Elysia().decorate('name ina', 'Ina')

		expect(app['~ext']?.decorator?.['name ina']).toBe('Ina')
	})

	// ─── Backward compatibility: legacy { as: ... } form ─────────────────

	it('legacy { as: override } object', async () => {
		const app = new Elysia()
			.decorate({
				name: 'Ina',
				job: 'artist'
			})
			.decorate({ as: 'override' }, { name: 'Fubuki' })

		expect(app['~ext']?.decorator).toEqual({
			name: 'Fubuki',
			job: 'artist'
		})
	})

	it('legacy { as: override } primitive by name', async () => {
		const app = new Elysia()
			.decorate('name', 'Ina')
			.decorate({ as: 'override' }, 'name', 'Tako')

		expect(app['~ext']?.decorator?.name).toBe('Tako')
	})

	it('legacy { as: append } primitive by name', async () => {
		const app = new Elysia()
			.decorate('name', 'Ina')
			.decorate({ as: 'append' }, 'name', 'Tako')

		// 'append' must NOT overwrite an existing key
		expect(app['~ext']?.decorator?.name).toBe('Ina')
	})

	// ─── Modern string-mode form ─────────────────────────────────────────

	it('explicit append primitive does not overwrite', async () => {
		const app = new Elysia()
			.decorate('name', 'Ina')
			.decorate('append', 'name', 'Tako')

		expect(app['~ext']?.decorator?.name).toBe('Ina')
	})

	it('explicit append object preserves existing keys', async () => {
		const app = new Elysia()
			.decorate({ name: 'Ina', job: 'artist' })
			.decorate('append', { name: 'Fubuki', team: 'hololive' })

		expect(app['~ext']?.decorator).toEqual({
			name: 'Ina',
			job: 'artist',
			team: 'hololive'
		})
	})
})
