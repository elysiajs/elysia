/**
 * Regression test for C7: JIT dependency slots linked by value equality.
 *
 * When two distinct parse slots (e.g. `parse.json` and `parse.default`) hold the
 * same function reference, the old Set<unknown>-based dedup silently dropped the
 * second alias.  The generated code still emitted `pd(c,ct)` — a ReferenceError
 * at request time because `pd` was never declared as a function parameter.
 *
 * Fix: dedup by slot key, not by value — each distinct slot always gets its own alias.
 */
import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { createAdapter } from '../../src/adapter'
import { WebStandardAdapter } from '../../src/adapter/web-standard'

describe('JIT slot dedup (C7)', () => {
	it('both pj and pd aliases are bound when parse.json === parse.default', async () => {
		// A single shared function stands in for both parse.json and parse.default.
		// This is the value-equality collision that the old code deduped incorrectly.
		const sharedParser = (ctx: any) => ctx.request.text()

		const adapter = createAdapter({
			...WebStandardAdapter,
			parse: {
				...WebStandardAdapter.parse,
				// point both slots at the identical function reference
				json: sharedParser,
				default: sharedParser
			}
		})

		const app = new Elysia({ adapter })
			// No explicit body type → jit.ts parse() hits the !hasType branch
			// which emits both `pj` and `pd` in the generated code (lines 314-320).
			.post('/', ({ body }) => body)

		// Use application/octet-stream: charCodeAt(12) = 'o' (111), not 'j' (106),
		// so the generated code takes the `pd` branch (not `pj`).
		// Before the fix, `pd` was undefined → ReferenceError at runtime because
		// link(adapter.default, 'pd') was silently dropped (same value as pj).
		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: 'hello'
			})
		)

		expect(res.status).toBe(200)
		// The sharedParser returns text; body is echoed back as-is
		await expect(res.text()).resolves.toBe('hello')
	})

	it('same slot registered twice does not duplicate the alias', async () => {
		// Sanity-check the legitimate same-slot dedup still works.
		// link(vali, 'va') is called multiple times in jit.ts — should emit va only once.
		// We can't observe the alias string directly, but a functional route proves
		// the generated code is valid (duplicate param names would cause a SyntaxError in
		// strict-mode new Function, or at minimum wrong binding).
		const app = new Elysia().post(
			'/echo',
			{ body: t.Object({ x: t.Number() }) },
			({ body }) => new Response(JSON.stringify(body))
		)

		const res = await app.handle(
			new Request('http://localhost/echo', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ x: 1 })
			})
		)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ x: 1 })
	})
})
