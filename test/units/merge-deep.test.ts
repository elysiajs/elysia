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
})
