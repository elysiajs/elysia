import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { mergeDeep } from '../../src/utils'

describe('mergeDeep', () => {
	it('merge empty object', () => {
		const result = mergeDeep({}, {})
		expect(result).toEqual({})
	})

	it('merge non-overlapping key', () => {
		const result = mergeDeep({ key1: 'value1' }, { key2: 'value2' })

		expect(result).toEqual({ key1: 'value1', key2: 'value2' })
	})

	it('merges arrays target-first without leaking into a shared source', () => {
		// Route macros may reuse the same source object.
		const source = { lifecycle: ['plugin', 'route'] }

		const a = mergeDeep({ lifecycle: ['a'] }, source, undefined, true, true)
		const b = mergeDeep({ lifecycle: ['b'] }, source, undefined, true, true)

		expect(a.lifecycle).toEqual(['a', 'plugin', 'route'])
		expect(b.lifecycle).toEqual(['b', 'plugin', 'route'])
		expect(source.lifecycle).toEqual(['plugin', 'route'])
	})

	it('merge overlapping key', () => {
		const result = mergeDeep(
			{
				name: 'Eula',
				city: 'Mondstadt'
			},
			{
				name: 'Amber',
				affiliation: 'Knight'
			}
		)

		expect(result).toEqual({
			name: 'Amber',
			city: 'Mondstadt',
			affiliation: 'Knight'
		})
	})

	it('maintain overlapping class', () => {
		class Test {
			readonly name = 'test'

			public foo() {
				return this.name
			}
		}

		const target = { key1: Test }
		const source = { key2: Test }

		const result = mergeDeep(target, source)
		expect(result.key1).toBe(Test)
	})

	it('maintain overlapping class in instance', async () => {
		class DbConnection {
			health() {
				return 'ok'
			}

			getUsers() {
				return []
			}
		}

		const dbPlugin = new Elysia({ name: 'db' }).decorate(
			'db',
			new DbConnection()
		)

		const userRoutes = new Elysia({ prefix: '/user' })
			.use(dbPlugin)
			.get('', ({ db }) => db.getUsers())

		const app = new Elysia()
			.use(dbPlugin)
			.use(userRoutes)
			.get('/health', ({ db }) => db.health())

		const response = await app.handle('/health').then((x) => x.text())

		expect(response).toBe('ok')
	})

	it('handle freezed object', () => {
		new Elysia()
			.decorate('db', Object.freeze({ hello: 'world' }))
			.guard({}, (app) => app)
	})

	it('handle circular references', () => {
		const a: {
			x: number
			toB?: typeof b
		} = { x: 1 }
		const b: {
			y: number
			toA?: typeof a
		} = { y: 2 }

		a.toB = b
		b.toA = a

		const target = {}
		const source = { prop: a }

		const result = mergeDeep(target, source)

		expect(result.prop.x).toBe(1)
		expect(result.prop.toB?.y).toBe(2)
	})

	it('handle shared references in different branches', () => {
		const shared = { value: 123 }
		const target = { x: {}, y: {} }
		const source = { x: shared, y: shared }

		const result = mergeDeep(target, source)

		expect(result.x.value).toBe(123)
		expect(result.y.value).toBe(123)
	})

	it('deduplicate plugin with circular decorators', async () => {
		const a: {
			x: number
			toB?: typeof b
		} = { x: 1 }
		const b: {
			y: number
			toA?: typeof a
		} = { y: 2 }
		a.toB = b
		b.toA = a

		const complex = { a }

		const Plugin = new Elysia({ name: 'Plugin', seed: 'seed' })
			.decorate('dep', complex)
			.as('plugin')

		const ModuleA = new Elysia({ name: 'ModuleA' })
			.use(Plugin)
			.get('/moda/a', ({ dep }) => dep.a.x)
			.get('/moda/b', ({ dep }) => dep.a.toB?.y)

		const ModuleB = new Elysia({ name: 'ModuleB' })
			.use(Plugin)
			.get('/modb/a', ({ dep }) => dep.a.x)
			.get('/modb/b', ({ dep }) => dep.a.toB?.y)

		const app = new Elysia().use(ModuleA).use(ModuleB)

		const resA = await app.handle('/moda/a').then((x) => x.text())
		const resB = await app.handle('/modb/a').then((x) => x.text())
		const resC = await app.handle('/moda/b').then((x) => x.text())
		const resD = await app.handle('/modb/b').then((x) => x.text())

		expect(resA).toBe('1')
		expect(resB).toBe('1')
		expect(resC).toBe('2')
		expect(resD).toBe('2')
	})

	it('ignores an override for a getter-only property', () => {
		const target: Record<string, unknown> = {}
		Object.defineProperty(target, 'sameKey', {
			get: () => 1,
			enumerable: true,
			configurable: false
		})

		expect(() =>
			mergeDeep(target, { sameKey: 2 }, undefined, true)
		).not.toThrow()
		expect(target.sameKey).toBe(1)
	})

	it('merges through a non-writable object property', () => {
		const inner = { a: 1 }
		const target: Record<string, unknown> = {}
		Object.defineProperty(target, 'cfg', {
			value: inner,
			writable: false,
			enumerable: true,
			configurable: false
		})

		expect(() =>
			mergeDeep(target, { cfg: { b: 2 } }, undefined, true)
		).not.toThrow()
		expect(inner).toEqual({ a: 1, b: 2 })
	})

	it('replaces a built-in value such as a Date instead of merging into it', async () => {
		// a Date has no own keys, so merging into it would keep the old instant
		expect(
			mergeDeep({ a: new Date(0) }, { a: new Date(1000) }).a.getTime()
		).toBe(1000)

		const decorated = new Elysia()
			.decorate({ now: new Date(0) })
			.decorate('override', { now: new Date(1000) })
			.get('/', ({ now }) => String(now.getTime()))
		const stored = new Elysia()
			.state({ now: new Date(0) })
			.state('override', { now: new Date(1000) })
			.get('/', ({ store }) => String(store.now.getTime()))
		const plugin = new Elysia()
			.decorate({ now: new Date(0) })
			.use(new Elysia().decorate('override', { now: new Date(1000) }))
			.get('/', ({ now }) => String(now.getTime()))

		for (const app of [decorated, stored, plugin])
			expect(
				await app
					.handle(new Request('http://localhost/'))
					.then((r) => r.text())
			).toBe('1000')
	})

	it('replaces a class instance that marks itself with its own toString()', async () => {
		// FFI-style values carry no Symbol.toStringTag, only a '[object X]' toString(); merging into one keeps the old private state
		class Client {
			#id: number
			constructor(id: number) {
				this.#id = id
			}
			get id() {
				return this.#id
			}
			toString() {
				return '[object Client]'
			}
		}

		expect(
			mergeDeep({ a: new Client(0) }, { a: new Client(1000) }).a.id
		).toBe(1000)

		const app = new Elysia()
			.decorate({ client: new Client(0) })
			.decorate('override', { client: new Client(1000) })
			.get('/', ({ client }) => String(client.id))

		expect(
			await app
				.handle(new Request('http://localhost/'))
				.then((r) => r.text())
		).toBe('1000')
	})
})
