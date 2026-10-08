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

// Stacked override guards resolve by scope, local > plugin > global: the same
// precedence the route types infer (`Volatile` over `Ephemeral` over
// `Metadata`, see test/types/schema-merge.ts) and Elysia 1.x enforces.
// Registration order only breaks a tie within one scope. Otherwise the
// enforced headers differ from the typed ones, so a handler can read a
// header that was never validated.
describe('stacked override guard precedence', () => {
	const A = () => ({ headers: t.Object({ a: t.String() }) })
	const B = () => ({ headers: t.Object({ b: t.String() }) })
	const C = () => ({ headers: t.Object({ c: t.String() }) })

	// which single header the app accepts, by status of a request carrying it
	const enforced = async (app: { handle(r: Request): Promise<Response> }) => {
		const status = async (name: string) =>
			(
				await app.handle(
					new Request('http://localhost/', {
						headers: { [name]: '1' }
					})
				)
			).status

		return {
			a: await status('a'),
			b: await status('b'),
			c: await status('c')
		}
	}

	it('local beats a later plugin guard', async () => {
		const app = new Elysia()
			.guard('local', A())
			.guard('plugin', B())
			.get('/', () => 1)

		expect(await enforced(app)).toEqual({ a: 200, b: 422, c: 422 })
	})

	it('local beats an earlier plugin guard', async () => {
		const app = new Elysia()
			.guard('plugin', B())
			.guard('local', A())
			.get('/', () => 1)

		expect(await enforced(app)).toEqual({ a: 200, b: 422, c: 422 })
	})

	it('plugin beats a later global guard', async () => {
		const app = new Elysia()
			.guard('plugin', B())
			.guard('global', C())
			.get('/', () => 1)

		expect(await enforced(app)).toEqual({ a: 422, b: 200, c: 422 })
	})

	it('local beats plugin and global guards registered around it', async () => {
		const app = new Elysia()
			.guard('plugin', B())
			.guard('local', A())
			.guard('global', C())
			.guard('plugin', B())
			.get('/', () => 1)

		expect(await enforced(app)).toEqual({ a: 200, b: 422, c: 422 })
	})

	it('keeps last-registered-wins within one scope', async () => {
		const app = new Elysia()
			.guard('local', A())
			.guard('local', B())
			.get('/', () => 1)

		expect(await enforced(app)).toEqual({ a: 422, b: 200, c: 422 })
	})

	it("applies the precedence to a plugin's own routes", async () => {
		const app = new Elysia().use(
			new Elysia()
				.guard('local', A())
				.guard('plugin', B())
				.get('/', () => 1)
		)

		expect(await enforced(app)).toEqual({ a: 200, b: 422, c: 422 })
	})

	// A used plugin's guard lands on the parent as the parent's own: it ties
	// with a parent local guard, so the later one wins (as in 1.x)
	it("a used plugin's guard ties with a parent local guard", async () => {
		const before = new Elysia()
			.use(new Elysia().guard('plugin', B()))
			.guard('local', A())
			.get('/', () => 1)

		expect(await enforced(before)).toEqual({ a: 200, b: 422, c: 422 })

		const after = new Elysia()
			.guard('local', A())
			.use(new Elysia().guard('plugin', B()))
			.get('/', () => 1)

		expect(await enforced(after)).toEqual({ a: 422, b: 200, c: 422 })
	})

	it("a used plugin's global guard yields to a parent local guard", async () => {
		const app = new Elysia()
			.guard('local', A())
			.use(new Elysia().guard('global', C()))
			.get('/', () => 1)

		expect(await enforced(app)).toEqual({ a: 200, b: 422, c: 422 })
	})

	it("schema: 'merge' still intersects across scopes", async () => {
		const app = new Elysia()
			.guard('local', { schema: 'merge', ...A() })
			.guard('plugin', { schema: 'merge', ...B() })
			.get('/', () => 1)

		expect(await enforced(app)).toEqual({ a: 422, b: 422, c: 422 })
		expect(
			(
				await app.handle(
					new Request('http://localhost/', {
						headers: { a: '1', b: '1' }
					})
				)
			).status
		).toBe(200)
	})

	it("a route's own schema still overrides every guard", async () => {
		const app = new Elysia()
			.guard('local', A())
			.guard('plugin', B())
			.get('/', C(), () => 1)

		expect(await enforced(app)).toEqual({ a: 422, b: 422, c: 200 })
	})
})
