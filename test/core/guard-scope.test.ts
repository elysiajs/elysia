import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'

// elysiajs/elysia#1967: `.guard({ as: 'plugin', body })` (the 1.x scope-in-hook
// form) was silently treated as a LOCAL guard, so the schema never reached any
// parent route — requests that violated the guard succeeded with the guarded
// field stripped. The 2.0 forms below must keep working, and the 1.x form must
// fail loudly instead of silently dropping enforcement.

const json = (path: string, payload: unknown) =>
	new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	})

describe('guard scope', () => {
	it('rejects the removed 1.x scope-in-hook form instead of ignoring it', () => {
		expect(() =>
			// @ts-expect-error `as` was removed in 2.0 (scope is the first argument)
			new Elysia().guard({
				as: 'plugin',
				body: t.Object({ org: t.String() })
			})
		).toThrow("guard({ as: 'plugin' }) was removed in 2.0")

		// 1.x `as: 'scoped'` maps to the 2.0 'plugin' scope in the message
		expect(() =>
			// @ts-expect-error `as` was removed in 2.0 (scope is the first argument)
			new Elysia().guard({
				as: 'scoped',
				body: t.Object({ org: t.String() })
			})
		).toThrow("guard('plugin', { ... })")
	})

	it('enforces a plugin-scoped guard schema on parent routes', async () => {
		const plugin = new Elysia({ name: 'org-guard' }).guard('plugin', {
			body: t.Object({ org: t.String() })
		})

		const app = new Elysia()
			.use(plugin)
			.post('/x', ({ body }) => body)

		expect(
			(await app.handle(json('/x', { content: 'hi' }))).status
		).toBe(422)
		expect(
			(await app.handle(json('/x', { org: 'o' }))).status
		).toBe(200)
	})

	it("merges a plugin-scoped guard schema with the route's own schema via schema: 'merge'", async () => {
		const plugin = new Elysia({ name: 'org-guard' }).guard('plugin', {
			schema: 'merge',
			body: t.Object({ org: t.String() })
		})

		const app = new Elysia()
			.use(plugin)
			.post('/x', { body: t.Object({ content: t.String() }) }, ({ body }) => body)

		// guard's slot stays enforced alongside the route's own schema
		const missing = await app.handle(json('/x', { content: 'hi' }))
		expect(missing.status).toBe(422)

		// both schemas decode: neither field is stripped
		const both = await app.handle(json('/x', { content: 'hi', org: 'o' }))
		expect(both.status).toBe(200)
		expect(await both.json()).toEqual({ content: 'hi', org: 'o' })
	})
})
