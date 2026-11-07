/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

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

		const res = await app.handle('/').then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().state('hi', () => 'hi')

		const app = new Elysia()
			.use(plugin)
			.get('/', ({ store: { hi } }) => hi())

		const res = await app.handle('/').then((r) => r.text())
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

	// A parsed object owns a real `__proto__` key. A later state call skips
	// it (and `constructor`), so the first call must too: otherwise the store
	// keeps an own `__proto__` that any spread or assign copy of it turns
	// into a prototype swap, and which keys survive depends on call order.
	it('first object call skips __proto__ and constructor like later calls', async () => {
		const input = () =>
			JSON.parse(
				'{"__proto__":{"polluted":"yes"},"constructor":"c","prototype":"p","x":1}'
			)

		const first = new Elysia().state(input())
		const later = new Elysia().state('a', 0).state(input())

		for (const app of [first, later]) {
			const store = app['~ext']!.store!
			expect(Object.hasOwn(store, '__proto__')).toBe(false)
			expect(Object.hasOwn(store, 'constructor')).toBe(false)
			expect(Object.hasOwn(store, 'prototype')).toBe(false)
			expect(store.x).toBe(1)
		}

		const response = await first
			.get('/', ({ store }: any) => ({
				own: Object.keys(store),
				polluted: typeof (store as any).polluted
			}))
			.handle(new Request('http://localhost/'))
			.then((x) => x.json())

		expect(response).toEqual({ own: ['x'], polluted: 'undefined' })
	})

	// The store has no sink that filters it, so every writer must hold the
	// same rule as the object form: the name form (`state('__proto__', v)`)
	// and a remapper's result, on the first or a later call. A store that
	// owns `__proto__` makes `Object.assign({}, store)` or a spread swap the
	// copy's prototype to the payload
	it('no writer leaves __proto__, constructor or prototype in the store', () => {
		const parsed = () =>
			JSON.parse(
				'{"__proto__":{"polluted":"yes"},"constructor":"c","prototype":"p","x":1}'
			)
		const nested = { deep: true }
		const symbol = Symbol('kept')
		const returned = { kept: 1, ...parsed() }

		const writers: Record<string, () => any> = {
			'name, first': () =>
				new Elysia()
					.state('__proto__', { polluted: 'yes' })
					.state('constructor', 'c')
					.state('prototype', () => 'p'),
			'name, later': () =>
				new Elysia()
					.state('a', 0)
					.state('__proto__', { polluted: 'yes' })
					.state('constructor', 'c')
					.state('prototype', () => 'p'),
			'name, override': () =>
				new Elysia()
					.state('a', 0)
					.state('override', '__proto__', { polluted: 'yes' }),
			'function, first': () =>
				new Elysia().state((store) => ({ ...store, ...parsed() })),
			'function, later': () =>
				new Elysia()
					.state('a', 0)
					.state((store) => ({ ...store, ...parsed() }))
		}

		for (const [name, build] of Object.entries(writers)) {
			const store = build()['~ext']?.store ?? {}
			const own = ['__proto__', 'constructor', 'prototype'].filter(
				(key) => Object.hasOwn(store, key)
			)

			expect(`${name}: ${own}`).toBe(`${name}: `)
			expect((Object.assign({}, store) as any).polluted).toBeUndefined()
		}

		// what the rule must not touch: other keys, the remapper's result as
		// the table, a nested value's identity, a symbol key
		const store = new Elysia().state(() => returned)['~ext']!.store as any
		expect(store).toBe(returned)
		expect(store.kept).toBe(1)
		expect(store.x).toBe(1)

		const named = new Elysia()
			.state('nested', nested)
			.state(symbol as any, 1)['~ext']!.store as any
		expect(named.nested).toBe(nested)
		expect(named[symbol]).toBe(1)
	})
})
