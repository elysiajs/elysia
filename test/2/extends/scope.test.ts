import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'

describe('macro order', () => {
	it('run in order', async () => {
		const order: unknown[] = []

		const a1 = new Elysia().beforeHandle('plugin', function a1() {
			order.push(1)
		})
		const a2 = new Elysia().beforeHandle('plugin', function a2() {
			order.push(2)
		})
		const a3 = new Elysia().beforeHandle('plugin', function a3() {
			order.push(3)
		})
		const a4 = new Elysia().beforeHandle('plugin', function a4() {
			order.push(4)
		})

		const q = new Elysia()
			.use(a1)
			.use(a2)
			.get('/', () => {
				return 'xd'
			})
			.use(a3)
			.use(a4)
			.get('/a', () => {
				return 'xd'
			})

		const app = new Elysia()
			.beforeHandle(function root() {
				order.push('root')
			})
			.use(q)
			.get('/b', () => 'xd')

		await app.handle('/b')
		expect(order).toEqual(['root'])

		order.length = 0
		await app.handle('/a')
		expect(order).toEqual(['root', 1, 2, 3, 4])
	})

	// Dual of "plugin scope propagates one level up": a plugin-scoped hook on
	// the parent must also apply DOWNWARD to routes absorbed via .use(). Locks
	// in the invariant before refactoring how downward propagation is computed.
	it('plugin-scoped hook on parent applies to absorbed sibling routes', async () => {
		let count = 0

		const sub = new Elysia({ prefix: '/sub' }).get('/r', () => 'ok')
		const parent = new Elysia()
			.beforeHandle('plugin', () => {
				count++
			})
			.use(sub)

		count = 0
		await parent.handle('/sub/r')
		expect(count).toBe(1)
	})

	// Regression (audit C1): a plugin's inherited hook chain (route tuple
	// index 6) must survive being absorbed under a prefix. The prefix branch
	// of #use rebuilt the route tuple WITHOUT the chain, so any inherited
	// guard/auth/beforeHandle silently stopped running once the composed app
	// was mounted under `new Elysia({ prefix })` — an auth-bypass. The
	// no-prefix and prefixed mounts must behave identically.
	it('inherited hook chain survives mounting under a prefix', async () => {
		const inner = new Elysia().get('/c', () => 'handler')
		const guarded = new Elysia()
			.beforeHandle(() => 'INTERCEPTED')
			.use(inner)

		const noPrefix = await new Elysia()
			.use(guarded)
			.handle('/c')
			.then((r) => r.text())

		const prefixed = await new Elysia({ prefix: '/v1' })
			.use(guarded)
			.handle('/v1/c')
			.then((r) => r.text())

		expect(noPrefix).toBe('INTERCEPTED')
		// before the fix this returned 'handler' (guard bypassed)
		expect(prefixed).toBe('INTERCEPTED')
	})
})
