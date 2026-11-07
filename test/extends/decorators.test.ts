/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

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

		const res = await app.handle('/').then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().decorate('hi', () => 'hi')

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle('/').then((r) => r.text())
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

	// Decorators become the context prototype's members. A parsed object
	// (config, JSON) owns a real `__proto__` key; if the first decorate call
	// copied it into the table, building the context would run the
	// `__proto__` setter and cut the Decorator base out of every context
	// (no `defer`) while exposing the payload's keys. A later call already
	// skipped these keys, so the first call must follow the same rule.
	it('first object call skips __proto__ and constructor like later calls', async () => {
		const input = () =>
			JSON.parse(
				'{"__proto__":{"polluted":"yes"},"constructor":"c","prototype":"p","x":1}'
			)

		const first = new Elysia().decorate(input())
		const later = new Elysia().decorate('a', 0).decorate(input())

		for (const app of [first, later]) {
			const table = app['~ext']!.decorator!
			expect(Object.hasOwn(table, '__proto__')).toBe(false)
			expect(Object.hasOwn(table, 'constructor')).toBe(false)
			expect(Object.hasOwn(table, 'prototype')).toBe(false)
			expect(table.x).toBe(1)
		}

		const response = await first
			.get('/', (c: any) => ({
				polluted: c.polluted ?? null,
				defer: typeof c.defer,
				x: c.x
			}))
			.handle(new Request('http://localhost/'))
			.then((x) => x.json())

		expect(response).toEqual({ polluted: null, defer: 'function', x: 1 })
	})

	// No API form leaves an own `__proto__` in the decorator table (see the
	// next test). Building the context must still never hand that key to the
	// prototype setter, for a table written past the API (the last app):
	// every context would lose `defer` and inherit the value.
	it('a __proto__ member never reaches the context prototype', async () => {
		const planted = new Elysia().decorate('x', 1)
		Object.defineProperty(planted['~ext']!.decorator!, '__proto__', {
			value: { polluted: 'yes' },
			enumerable: true,
			configurable: true
		})

		const apps: any[] = [
			new Elysia().decorate('__proto__', { polluted: 'yes' }),
			new Elysia()
				.decorate('a', 0)
				.decorate('__proto__', { polluted: 'yes' }),
			new Elysia().decorate((t) => ({
				...t,
				...JSON.parse('{"__proto__":{"polluted":"yes"},"x":1}')
			})),
			planted
		]

		for (const app of apps) {
			const response = await app
				.get('/', (c: any) => ({
					polluted: c.polluted ?? null,
					defer: typeof c.defer
				}))
				.handle(new Request('http://localhost/'))
				.then((x: Response) => x.json())

			expect(response).toEqual({ polluted: null, defer: 'function' })
		}
	})

	// The table itself must hold the rule, not only the context built from
	// it: it is copied by plugin merging and read by introspection, where an
	// own `__proto__` turns a spread or assign copy into a prototype swap.
	// Every writer: the name form and a remapper's result, first or later
	it('no writer leaves __proto__, constructor or prototype in the table', () => {
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
					.decorate('__proto__', { polluted: 'yes' })
					.decorate('constructor', 'c')
					.decorate('prototype', () => 'p'),
			'name, later': () =>
				new Elysia()
					.decorate('a', 0)
					.decorate('__proto__', { polluted: 'yes' })
					.decorate('constructor', 'c')
					.decorate('prototype', () => 'p'),
			'name, override': () =>
				new Elysia()
					.decorate('a', 0)
					.decorate('override', '__proto__', { polluted: 'yes' }),
			'function, first': () =>
				new Elysia().decorate((table) => ({ ...table, ...parsed() })),
			'function, later': () =>
				new Elysia()
					.decorate('a', 0)
					.decorate((table) => ({ ...table, ...parsed() }))
		}

		for (const [name, build] of Object.entries(writers)) {
			const table = build()['~ext']?.decorator ?? {}
			const own = ['__proto__', 'constructor', 'prototype'].filter(
				(key) => Object.hasOwn(table, key)
			)

			expect(`${name}: ${own}`).toBe(`${name}: `)
			expect((Object.assign({}, table) as any).polluted).toBeUndefined()
		}

		// what the rule must not touch: other keys, the remapper's result as
		// the table, a nested value's identity, a symbol key
		const table = new Elysia().decorate(() => returned)['~ext']!
			.decorator as any
		expect(table).toBe(returned)
		expect(table.kept).toBe(1)
		expect(table.x).toBe(1)

		const named = new Elysia()
			.decorate('nested', nested)
			.decorate(symbol as any, 1)['~ext']!.decorator as any
		expect(named.nested).toBe(nested)
		expect(named[symbol]).toBe(1)
	})
})
