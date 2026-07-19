import { Elysia } from '../../src'
import { resumeEmit } from '../../src/experimental/resume'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('mapDerive', () => {
	for (const [mode, config] of [
		['jit', {}],
		['resume', { experimental: { resumeEmit } }]
	] as const)
		it(`preserves Context identity in ${mode}`, async () => {
			const contexts: any[] = []
			let prototype: object | null
			let oldInMap: unknown
			let mapContext: any
			let getterCalls = 0
			const getterObservations: any[] = []
			const derivative = {
				get mapped() {
					getterCalls++
					getterObservations.push({
						context: mapContext,
						old: mapContext.old,
						path: mapContext.path
					})
					return `mapped-${getterCalls}`
				},
				request: 'wrong',
				store: 'wrong',
				set: 'wrong',
				path: 'wrong'
			}
			let observed: any

			const app = new Elysia(config)
				.state('name', 'Elysia')
				.derive((context) => {
					contexts.push(context)
					return { old: 'old' }
				})
				.mapDerive((context: any) => {
					contexts.push(context)
					mapContext = context
					oldInMap = context.old
					return derivative
				})
				.get(
					'/identity',
					{
						transform(context) {
							contexts.push(context)
							prototype = Object.getPrototypeOf(context)
						},
						beforeHandle(context) {
							contexts.push(context)
						},
						afterHandle(context) {
							contexts.push(context)
						}
					},
					(context: any) => {
						contexts.push(context)
						observed = {
							old: context.old,
							mapped: [context.mapped, context.mapped],
							request: context.request,
							store: context.store,
							set: context.set,
							path: context.path
						}
						return 'ok'
					}
				)

			const request = req('/identity')
			await app.handle(request)

			expect(contexts).toHaveLength(6)
			expect(contexts.every((context) => context === contexts[0])).toBeTrue()
			expect(Object.getPrototypeOf(contexts[0])).toBe(prototype!)
			expect(oldInMap).toBe('old')
			expect(observed).toEqual({
				old: undefined,
				mapped: ['mapped-1', 'mapped-1'],
				request,
				store: { name: 'Elysia' },
				set: observed.set,
				path: '/identity'
			})
			expect(getterCalls).toBe(1)
			expect(getterObservations).toEqual([
				{ context: contexts[0], old: 'old', path: '/identity' }
			])
			expect(derivative).toEqual({
				mapped: 'mapped-2',
				request: 'wrong',
				store: 'wrong',
				set: 'wrong',
				path: 'wrong'
			})
			expect(getterCalls).toBe(2)
		})

	it('replaces the derived context with its returned fields', async () => {
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

	it('maps a global derive inside a plugin', async () => {
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

	it('keeps a local mapped derive inside its plugin', async () => {
		const plugin = new Elysia()
			.derive(() => ({
				hi: () => 'hi'
			}))
			.mapDerive((derivatives) => ({
				...derivatives,
				hi2: () => 'hi'
			}))
			.get('/mapped', ({ hi2 }) => hi2())

		const app = new Elysia()
			.use(plugin)
			// @ts-expect-error
			.get('/', ({ hi2 }) => typeof hi2 === 'undefined')

		const [outer, inner] = await Promise.all([
			app.handle(req('/')).then((response) => response.text()),
			app.handle(req('/mapped')).then((response) => response.text())
		])

		expect(outer).toBe('true')
		expect(inner).toBe('hi')
	})

	it('can expose a helper that mutates the store', async () => {
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

	it('can read a destructured request header', async () => {
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

	it('runs between app and route-local beforeHandle hooks', async () => {
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

	it('runs mapped derives in registration order', async () => {
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

	it('runs locally only on routes declared by its plugin', async () => {
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

	it('runs globally on plugin and parent routes', async () => {
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

		const app = new Elysia().use(plugin).get('/', (context: any) => ({
			old: context.old,
			name: context.name
		}))

		const res = await app.handle(req('/')).then((t) => t.json())

		expect(res).toEqual({
			name: 'Elysia'
		})
	})

	it('preserves request context fields beside mapped properties', async () => {
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

	it('gives request context fields precedence over mapped properties', async () => {
		let capturedPath: any

		const app = new Elysia()
			.mapDerive(() => ({
				path: 'SHOULD_BE_OVERWRITTEN'
			}))
			.get('/real-path', (context: any) => {
				capturedPath = context.path
				return 'ok'
			})

		await app.handle(req('/real-path'))

		expect(capturedPath).toBe('/real-path')
	})

	it('does not mutate a shared returned object', async () => {
		const shared = { user: 'x' }
		const originalProto = Object.getPrototypeOf(shared)

		const app = new Elysia().mapDerive(() => shared).get('/', () => 'ok')

		await app.handle(req('/'))
		await app.handle(req('/'))

		expect(Object.getPrototypeOf(shared)).toBe(originalProto)
		expect('request' in shared).toBe(false)
		expect('set' in shared).toBe(false)
	})

	it('does not copy request state onto a shared returned object', async () => {
		const shared = { user: 'singleton' }
		const setValues: any[] = []

		const app = new Elysia()
			.mapDerive(() => shared)
			.get('/', () => {
				setValues.push(
					'set' in shared ? (shared as any).set : undefined
				)
				return 'ok'
			})

		await app.handle(req('/'))
		await app.handle(req('/'))

		expect(setValues[0]).toBeUndefined()
		expect(setValues[1]).toBeUndefined()
	})

	it('snapshots getter values when merging mapped properties', async () => {
		let callCount = 0
		const derivative = {
			get computed() {
				callCount++
				return 'computed-' + callCount
			}
		}

		const app = new Elysia()
			.mapDerive(() => derivative)
			.get('/', (context: any) => [context.computed, context.computed])

		const res = await app
			.handle(req('/'))
			.then((response) => response.json())

		expect(res).toEqual(['computed-1', 'computed-1'])
		expect(callCount).toBe(1)
	})
})
