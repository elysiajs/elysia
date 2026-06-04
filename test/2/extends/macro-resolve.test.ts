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
			.macro({ withUser: { resolve: () => ({ user: 'alice' }) } } as any)
			.get('/', ({ user }: any) => ({ user }), { withUser: true } as any)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ user: 'alice' })
	})

	it('a macro returning `derive` exposes the value to the handler', async () => {
		const app = new Elysia()
			.macro({ withRole: { derive: () => ({ role: 'admin' }) } } as any)
			.get('/', ({ role }: any) => ({ role }), { withRole: true } as any)

		const res = await app.handle(req('/'))
		expect(await res.json()).toEqual({ role: 'admin' })
	})

	it('macro `resolve` sees the request (promoted into beforeHandle)', async () => {
		const app = new Elysia()
			.macro({
				gate: {
					resolve: ({ query }: any) => ({
						value: query.deny ? 'denied' : 'ok'
					})
				}
			} as any)
			.get('/', ({ value }: any) => value, { gate: true } as any)

		expect(await (await app.handle(req('/'))).text()).toBe('ok')
		expect(await (await app.handle(req('/?deny=1'))).text()).toBe('denied')
	})
})
