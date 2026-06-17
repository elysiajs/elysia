import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../../src'

describe('guard(scope, hook) bulk registration', () => {
	it('propagates beforeHandle to consumer when scope is global', async () => {
		const order: number[] = []

		const a = new Elysia()
			.beforeHandle('global', () => {
				order.push(1)
			})
			.guard('global', {
				beforeHandle() {
					order.push(2)
				}
			})

		const app = new Elysia().use(a).get('/', () => 'ok')

		await app.handle('/')
		expect(order).toEqual([1, 2])
	})

	it('propagates plugin scope one level up', async () => {
		let count = 0

		const inner = new Elysia().guard('plugin', {
			beforeHandle() {
				count++
			}
		})

		const parent = new Elysia().use(inner).get('/', () => 'ok')
		const grandparent = new Elysia().use(parent).get('/g', () => 'ok')

		await parent.handle('/')
		expect(count).toBe(1)

		count = 0
		await grandparent.handle('/g')
		expect(count).toBe(0)
	})

	it('does not propagate when scope is local', async () => {
		let count = 0

		const a = new Elysia().guard('local', {
			beforeHandle() {
				count++
			}
		})

		const app = new Elysia().use(a).get('/', () => 'ok')

		await app.handle('/')
		expect(count).toBe(0)
	})

	it('route-local schema overrides a propagated global guard schema', async () => {
		const a = new Elysia().guard('global', {
			query: t.Object({ b: t.String() })
		})

		const app = new Elysia().use(a).get(
			'/',
			{
				query: t.Object({ a: t.String() })
			},
			() => 'ok'
		)

		// Guards default to the OVERRIDE channel: the route's own `query`
		// replaces the propagated guard query, so only `a` is required.
		const ok = await app.handle('/?a=foo')
		expect(ok.status).toBe(200)

		const missingA = await app.handle('/?b=bar')
		expect(missingA.status).not.toBe(200)
	})

	it('standalone global guard schema stays additive on consumer routes', async () => {
		const a = new Elysia().guard('global', {
			schema: 'standalone',
			query: t.Object({ b: t.String() })
		})

		const app = new Elysia().use(a).get(
			'/',
			{
				query: t.Object({ a: t.String() })
			},
			() => 'ok'
		)

		// `schema: 'standalone'` opts into additive validation: the route
		// requires both `a` (own schema) and `b` (propagated guard).
		const ok = await app.handle('/?a=foo&b=bar')
		expect(ok.status).toBe(200)

		const missingB = await app.handle('/?a=foo')
		expect(missingB.status).not.toBe(200)
	})

	it('does not propagate schema when scope is local', async () => {
		const a = new Elysia().guard('local', {
			query: t.Object({ b: t.String() })
		})

		const app = new Elysia().use(a).get('/', () => 'ok')

		// Consumer route never declared `b`, and local scope must not bleed
		// the guard schema upward — request without `b` should succeed.
		const res = await app.handle('/')
		expect(res.status).toBe(200)
	})

	it('propagates multiple events from a single guard call', async () => {
		const order: string[] = []

		const a = new Elysia().guard('global', {
			beforeHandle() {
				order.push('before')
			},
			afterHandle() {
				order.push('after')
			}
		})

		const app = new Elysia().use(a).get('/', () => 'ok')

		await app.handle('/')
		expect(order).toEqual(['before', 'after'])
	})
})
