import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { mergeDeep } from '../../src/utils'
import { req } from '../utils'

describe('mergeDeep', () => {
	it('merge empty object', () => {
		const result = mergeDeep({}, {})
		expect(result).toEqual({})
	})

	it('merge non-overlapping key', () => {
		const result = mergeDeep({ key1: 'value1' }, { key2: 'value2' })

		expect(result).toEqual({ key1: 'value1', key2: 'value2' })
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

		const response = await app.handle(req('/health')).then((x) => x.text())

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
			.as('scoped')

		const ModuleA = new Elysia({ name: 'ModuleA' })
			.use(Plugin)
			.get('/moda/a', ({ dep }) => dep.a.x)
			.get('/moda/b', ({ dep }) => dep.a.toB?.y)

		const ModuleB = new Elysia({ name: 'ModuleB' })
			.use(Plugin)
			.get('/modb/a', ({ dep }) => dep.a.x)
			.get('/modb/b', ({ dep }) => dep.a.toB?.y)

		const app = new Elysia().use(ModuleA).use(ModuleB)

		const resA = await app.handle(req('/moda/a')).then((x) => x.text())
		const resB = await app.handle(req('/modb/a')).then((x) => x.text())
		const resC = await app.handle(req('/moda/b')).then((x) => x.text())
		const resD = await app.handle(req('/modb/b')).then((x) => x.text())

		expect(resA).toBe('1')
		expect(resB).toBe('1')
		expect(resC).toBe('2')
		expect(resD).toBe('2')
	})
})
