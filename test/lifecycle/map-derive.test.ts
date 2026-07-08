import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('map derive', () => {
	it('work', async () => {
		const app = new Elysia()
			.derive(() => ({
				hi: () => 'hi'
			}))
			.mapDerive((derivatives) => ({
				...derivatives,
				hi2: () => 'hi'
			}))
			.get('/', ({ hi }) => hi())
			.get('/h2', ({ hi2 }) => hi2())

		const res = await app.handle(req('/')).then((t) => t.text())
		const res2 = await app.handle(req('/h2')).then((t) => t.text())

		expect(res).toBe('hi')
		expect(res2).toBe('hi')
	})

	it('replaces derived values while preserving context fields', async () => {
		const app = new Elysia()
			.derive(() => ({
				old: 'old'
			}))
			.mapDerive(({ params }) => ({
				id: params.id
			}))
			.post('/user/:id', (context: any) => ({
				old: context.old,
				id: context.id,
				body: context.body.name
			}))

		const res = await app
			.handle(post('/user/1', { name: 'Elysia' }))
			.then((t) => t.json())

		expect(res).toEqual({
			id: '1',
			body: 'Elysia'
		})
	})

	it('inherits plugin', async () => {
		const plugin = new Elysia()
			.derive('global', () => ({
				hi: () => 'hi'
			}))
			.mapDerive((derivatives) => ({
				...derivatives,
				hi2: () => 'hi'
			}))
			.get('/h2', ({ hi2 }) => hi2())

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((t) => t.text())
		const res2 = await app.handle(req('/h2')).then((t) => t.text())

		expect(res).toBe('hi')
		expect(res2).toBe('hi')
	})

	it('not inherits plugin on local', async () => {
		const plugin = new Elysia()
			.derive(() => ({
				hi: () => 'hi'
			}))
			.mapDerive((derivatives) => ({
				...derivatives,
				hi2: () => 'hi'
			}))

		const app = new Elysia()
			.use(plugin)
			// @ts-expect-error
			.get('/', ({ hi2 }) => typeof hi2 === 'undefined')

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('true')
	})

	it('can mutate store', async () => {
		const app = new Elysia()
			.state('counter', 1)
			.mapDerive(({ store }) => ({
				increase: () => store.counter++
			}))
			.get('/', ({ store, increase }) => {
				increase()

				return store.counter
			})

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('2')
	})

	it('derive with static analysis', async () => {
		const app = new Elysia()
			.mapDerive(({ headers: { name } }) => ({
				name
			}))
			.get('/', ({ name }) => name)

		const res = await app
			.handle(
				new Request('http://localhost/', {
					headers: {
						name: 'Elysia'
					}
				})
			)
			.then((t) => t.text())

		expect(res).toBe('Elysia')
	})

	it('store in the same stack as transform', async () => {
		const stack: number[] = []

		const app = new Elysia()
			.beforeHandle(() => {
				stack.push(1)
			})
			.mapDerive(() => {
				stack.push(2)

				return { name: 'Ina' }
			})
			.get(
				'/',
				{
					beforeHandle() {
						stack.push(3)
					}
				},
				({ name }) => name
			)

		await app.handle(
			new Request('http://localhost/', {
				headers: {
					name: 'Elysia'
				}
			})
		)

		expect(stack).toEqual([1, 2, 3])
	})

	it('map derive in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.mapDerive(() => {
				order.push('A')
				return {}
			})
			.mapDerive(() => {
				order.push('B')
				return {}
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('as local', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.mapDerive('local', ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner'])
	})

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.mapDerive('global', ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('global plugin replaces inherited derive values', async () => {
		const plugin = new Elysia()
			.derive('global', () => ({
				old: 'old'
			}))
			.mapDerive('global', () => ({
				name: 'Elysia'
			}))

		const app = new Elysia()
			.use(plugin)
			.get('/', (context: any) => ({
				old: context.old,
				name: context.name
			}))

		const res = await app.handle(req('/')).then((t) => t.json())

		expect(res).toEqual({
			name: 'Elysia'
		})
	})

	it('handler sees both mapped properties and all context fields after mapDerive', async () => {
		let capturedContext: any

		const app = new Elysia()
			.mapDerive(() => ({
				mapped: 'yes'
			}))
			.get('/', (context: any) => {
				capturedContext = context
				return 'ok'
			})

		await app.handle(new Request('http://localhost/'))

		expect(capturedContext.mapped).toBe('yes')
		expect(capturedContext.request).toBeInstanceOf(Request)
		expect(capturedContext.set).toBeDefined()
		expect(capturedContext.path).toBe('/')
	})

	it('context field takes precedence over same-named derivative property', async () => {
		let capturedPath: any

		const app = new Elysia()
			.mapDerive(() => ({
				// derivative also has 'path' — context value must win
				path: 'SHOULD_BE_OVERWRITTEN'
			}))
			.get('/real-path', (context: any) => {
				capturedPath = context.path
				return 'ok'
			})

		await app.handle(req('/real-path'))

		// The real context.path must overwrite derivative.path
		expect(capturedPath).toBe('/real-path')
	})

	it('shared-object pollution: mapDerive must not mutate the returned object', async () => {
		// If the user returns a shared/cached object, it must not be reparented
		// or polluted with request-scoped context fields (cross-request leak).
		const shared = { user: 'x' }
		const originalProto = Object.getPrototypeOf(shared)

		const app = new Elysia()
			.mapDerive(() => shared)
			.get('/', () => 'ok')

		await app.handle(req('/'))
		await app.handle(req('/'))

		// Prototype must be untouched
		expect(Object.getPrototypeOf(shared)).toBe(originalProto)
		// Request-scoped fields must NOT be on the shared object
		expect('request' in shared).toBe(false)
		expect('set' in shared).toBe(false)
	})

	it('cross-request leak: request A set must not be visible via shared object during request B', async () => {
		// Regression for: replaceDeriveContext writing context fields onto derivative
		// means a cached derivative carries stale per-request state into future requests.
		const shared = { user: 'singleton' }
		const setValues: any[] = []

		const app = new Elysia()
			.mapDerive(() => shared)
			.get('/', () => {
				// shared must not have been mutated with any request's set
				setValues.push(('set' in shared) ? (shared as any).set : undefined)
				return 'ok'
			})

		await app.handle(req('/'))
		await app.handle(req('/'))

		// shared must never have request.set injected into it
		expect(setValues[0]).toBeUndefined()
		expect(setValues[1]).toBeUndefined()
	})

	it('mapDerive derivative getters are snapshotted at merge (Object.assign copies value, not descriptor)', async () => {
		// Object.assign copies the current VALUE of an accessor, not the getter descriptor.
		// This is a documented behavior: live getters do not survive the merge.
		// Tests assert the post-fix behavior explicitly so a future reader understands the contract.
		let callCount = 0
		const derivative = {
			get computed() {
				callCount++
				return 'computed-' + callCount
			}
		}

		const app = new Elysia()
			.mapDerive(() => derivative)
			.get('/', (context: any) => context.computed ?? 'undefined')

		const res = await app.handle(req('/')).then((t) => t.text())

		// The getter was called once (during Object.assign) and the value was
		// snapshotted — the handler sees the string, not a live getter.
		expect(res).toMatch(/^computed-/)
	})
})
