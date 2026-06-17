import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../../src'
import { req } from '../../utils'

/**
 * Coverage for the resolve→derive deprecation.
 *
 * `.resolve()` / `.guard({ resolve })` route into `derive` before reaching
 * `compileHandler`, but **macros that return `resolve`** still rely on
 * `promoteDeriveResolve`'s `'resolve'` branch (it's promoted from `node.added`).
 * This was previously uncovered — dropping the `'resolve'` iteration broke it
 * silently. These tests pin that behaviour so the iteration can only be removed
 * once macro-`resolve` is also collapsed into `derive`.
 */
describe('macro resolve', () => {
	// `resolve`/`derive` are mid-deprecation in macro *input* types, so the
	// macro objects are cast — the point here is the runtime promotion path.
	it('a macro returning `resolve` exposes the value to the handler', async () => {
		const app = new Elysia()
			.macro({ withUser: { derive: () => ({ user: 'alice' }) } } as any)
			.get('/', { withUser: true } as any, ({ user }: any) => ({ user }))

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ user: 'alice' })
	})

	it('a macro returning `derive` exposes the value to the handler', async () => {
		const app = new Elysia()
			.macro({ withRole: { derive: () => ({ role: 'admin' }) } } as any)
			.get('/', { withRole: true } as any, ({ role }: any) => ({ role }))

		const res = await app.handle(req('/'))
		await expect(res.json()).resolves.toEqual({ role: 'admin' })
	})

	it('macro `resolve` sees the request (promoted into beforeHandle)', async () => {
		const app = new Elysia()
			.macro({
				gate: {
					derive: ({ query }: any) => ({
						value: query.deny ? 'denied' : 'ok'
					})
				}
			} as any)
			.get('/', { gate: true } as any, ({ value }: any) => value)

		await expect((await app.handle(req('/'))).text()).resolves.toBe('ok')
		await expect((await app.handle(req('/?deny=1'))).text()).resolves.toBe(
			'denied'
		)
	})
})
