/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../../src/2'
import { req } from '../../utils'

describe('State', () => {
	it('state primitive', async () => {
		const app = new Elysia().state('name', 'Ina').state('name', 'Tako')

		expect(app['~ext']?.store?.name).toBe('Ina')
	})

	it('state multiple', async () => {
		const app = new Elysia().state('name', 'Ina').state('job', 'artist')

		expect(app['~ext']?.store).toEqual({
			name: 'Ina',
			job: 'artist'
		})
	})

	it('state object', async () => {
		const app = new Elysia()
			.state({
				name: 'Ina',
				job: 'artist'
			})
			.state({
				name: 'Fubuki'
			})

		expect(app['~ext']?.store).toEqual({
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

		expect(app['~ext']?.store).toEqual({
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

		expect(app['~ext']?.store?.hi.there.hello).toBe('world')
	})

	it('remap', async () => {
		const app = new Elysia()
			.state('job', 'artist')
			.state('name', 'Ina')
			.state(({ job, ...store }) => ({
				...store,
				job: 'vtuber'
			}))

		expect(app['~ext']?.store?.job).toBe('vtuber')
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

		expect(app['~ext']?.store?.a.i).toBe(0)
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

		expect(app['~ext']?.store).toEqual({
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
			.state('override', 'name', 'Tako')

		expect(app['~ext']?.store?.name).toBe('Tako')
	})

	it('override object', async () => {
		const app = new Elysia()
			.state({
				name: 'Ina',
				job: 'artist'
			})
			.state('override', {
				name: 'Fubuki'
			})

		expect(app['~ext']?.store).toEqual({
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
			.state('override', 'a', new A())

		expect(app['~ext']?.store?.a.i).toBe(1)
	})

	it('override nested object deduplication using name', async () => {
		const app = new Elysia()
			.state('a', {
				hello: {
					world: 'Tako'
				}
			})
			.state('override', 'a', {
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			})

		expect(app['~ext']?.store?.a.hello).toEqual({
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
			.state('override', {
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			})

		expect(app['~ext']?.store?.hello).toEqual({
			world: 'Ina',
			cookie: 'wah!'
		})
	})

	// ─── Backward compatibility: legacy { as: ... } form ─────────────────

	it('legacy { as: override } primitive by name', async () => {
		const app = new Elysia()
			.state('name', 'Ina')
			.state({ as: 'override' }, 'name', 'Tako')

		expect(app['~ext']?.store?.name).toBe('Tako')
	})

	it('legacy { as: override } object', async () => {
		const app = new Elysia()
			.state({
				name: 'Ina',
				job: 'artist'
			})
			.state({ as: 'override' }, { name: 'Fubuki' })

		expect(app['~ext']?.store).toEqual({
			name: 'Fubuki',
			job: 'artist'
		})
	})

	it('legacy { as: append } primitive by name', async () => {
		const app = new Elysia()
			.state('name', 'Ina')
			.state({ as: 'append' }, 'name', 'Tako')

		// 'append' must NOT overwrite an existing key
		expect(app['~ext']?.store?.name).toBe('Ina')
	})

	// ─── Modern string-mode form ─────────────────────────────────────────

	it('explicit append primitive does not overwrite', async () => {
		const app = new Elysia()
			.state('name', 'Ina')
			.state('append', 'name', 'Tako')

		expect(app['~ext']?.store?.name).toBe('Ina')
	})

	it('explicit append object preserves existing keys', async () => {
		const app = new Elysia()
			.state({ name: 'Ina', job: 'artist' })
			.state('append', { name: 'Fubuki', team: 'hololive' })

		expect(app['~ext']?.store).toEqual({
			name: 'Ina',
			job: 'artist',
			team: 'hololive'
		})
	})
})
