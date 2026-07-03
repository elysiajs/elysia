/**
 * Regression pins for four registration-path defects from the fable full
 * review (design/fable-full-review.md): M12, H15, M13, M31.
 *
 * Each test encodes WHY the behavior matters — every one of these is a silent
 * auth/scoping footgun where a v1 pattern compiled and ran with different
 * (weaker) semantics instead of failing loud. The pre-existing suite passed
 * *with* these bugs present, so these tests encode the intent the fixes
 * restored.
 */
import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'

const req = (path: string, init?: RequestInit) =>
	new Request('http://localhost' + path, init)

describe('fable review — registration footguns', () => {
	// ---- M12 — group() child must not inherit config.as -------------------
	// A parent constructed with `as: 'global'` makes every lifecycle hook
	// registered via a method (.beforeHandle etc.) default to global scope
	// (via #on reading ~config.as). If the group scope-child inherited that
	// `as`, a hook registered INSIDE the group would be scope-lifted OUT onto
	// the parent / whole consuming app — a group-scoped auth check silently
	// applying to (or here, blocking) unrelated sibling routes.
	describe('M12 group() does not inherit config.as', () => {
		it('group-registered hook stays scoped to the group under as:global', async () => {
			const app = new Elysia({ as: 'global' })
				.group('/g', (g) =>
					g
						.beforeHandle(() => {
							throw new Error('GROUP-BLOCK')
						})
						.get('/in', () => 'in')
				)
				.get('/out', () => 'out')

			// hook applies inside the group
			expect((await app.handle(req('/g/in'))).status).toBe(500)
			// hook must NOT escape onto the sibling registered on the parent
			expect((await app.handle(req('/out'))).status).toBe(200)
		})

		it('guard(hook, run) child does not inherit config.as either', async () => {
			// guard(hook, run) routes through group('', hook, run); same child.
			const app = new Elysia({ as: 'global' })
				.guard({ beforeHandle: () => 'guarded' }, (g) =>
					g.get('/inner', () => 'inner')
				)
				.get('/sibling', () => 'sibling')

			// The guard's beforeHandle short-circuits inside its own scope
			expect(await (await app.handle(req('/inner'))).text()).toBe(
				'guarded'
			)
			// but must not leak onto the parent sibling
			expect(await (await app.handle(req('/sibling'))).text()).toBe(
				'sibling'
			)
		})
	})

	// ---- H15 — guard({ as }) must throw ----------------------------------
	// v1 `guard({ as: 'global', ...hooks })` type-checks clean in v2 (the open
	// macro Input generic swallows the extra key) but `as` was silently
	// ignored, degrading global scope to local — an auth-scope downgrade with
	// no diagnostic. Fail loud instead.
	describe('H15 guard({ as }) throws', () => {
		it('one-arg guard with an `as` key throws a migration error', () => {
			expect(() =>
				new Elysia().guard({
					// @ts-expect-error removed v1 pattern
					as: 'global',
					beforeHandle: () => {}
				})
			).toThrow('guard({ as }) was removed in Elysia 2')
		})

		it('two-arg guard(scope, hook) with an `as` key also throws', () => {
			expect(() =>
				(new Elysia() as any).guard('global', {
					as: 'scoped',
					beforeHandle: () => {}
				})
			).toThrow('guard({ as }) was removed in Elysia 2')
		})

		it('plain guard without `as` still works (no false positive)', async () => {
			const app = new Elysia()
				.guard({ beforeHandle: () => {} })
				.get('/', () => 'ok')

			expect(await (await app.handle(req('/'))).text()).toBe('ok')
		})

		it('ElysiaConfig.as (constructor option) is unaffected', async () => {
			const app = new Elysia({ as: 'global' }).get('/', () => 'ok')
			expect((await app.handle(req('/'))).status).toBe(200)
		})
	})

	// ---- M13 — resolve key in hooks/macros must throw --------------------
	// `resolve` was v1's canonical validate-then-inject auth pattern. It was
	// removed in v2 (use `derive`), but a `resolve` key on a guard/route hook
	// object or a macro definition body was silently DROPPED — the injected
	// auth context vanished with no error. Fail loud at registration.
	describe('M13 resolve key throws', () => {
		const message = 'resolve was removed in Elysia 2 — use derive instead'

		it('guard({ resolve }) throws', () => {
			expect(() =>
				new Elysia().guard({
					// @ts-expect-error removed v1 pattern
					resolve: () => ({ user: 'admin' })
				})
			).toThrow(message)
		})

		it('route-level hook { resolve } throws', () => {
			expect(() =>
				new Elysia().get(
					'/',
					// @ts-expect-error removed v1 pattern
					{ resolve: () => ({ user: 'admin' }) },
					() => 'ok'
				)
			).toThrow(message)
		})

		it('macro definition body { resolve } throws (object form)', () => {
			expect(() =>
				new Elysia().macro({
					// @ts-expect-error removed v1 pattern
					auth: { resolve: () => ({ user: 'admin' }) }
				})
			).toThrow(message)
		})

		it('macro definition { resolve } throws (function form)', () => {
			// Function-form macro bodies are produced lazily, so the throw
			// surfaces when the macro is applied — since M34 composes hooks
			// at build, that is now a loud build-time throw (was a
			// per-request 500) — still fails loud, never silently drops.
			const app = new Elysia()
				.macro({
					auth: () => ({ resolve: () => ({ user: 'admin' }) })
				} as any)
				.get('/', { auth: true } as any, (c: any) => c.user ?? 'NONE')

			expect(() => app.compile()).toThrow(message)
		})

		it('derive (the replacement) still works on a guard', async () => {
			const app = new Elysia()
				.guard({ derive: () => ({ user: 'admin' }) } as any)
				.get('/', (c: any) => c.user ?? 'NONE')

			expect(await (await app.handle(req('/'))).text()).toBe('admin')
		})
	})

	// ---- M31 — guard schema default is 'override', not 'standalone' -------
	// Empirical pin of the RUNTIME default: two nested guards with different
	// body schemas and no explicit `schema` key. If the default were
	// 'standalone' both would apply (both `a` and `b` required). The actual
	// default is 'override' (last guard wins, outer keys stripped), so only
	// the inner `b` is required. This locks the behavior the JSDoc/type
	// default now documents.
	it("M31 guard schema default is 'override' (last guard wins)", async () => {
		const app = new Elysia().guard(
			{ body: t.Object({ a: t.String() }) },
			(g) =>
				g.guard({ body: t.Object({ b: t.String() }) }, (g2) =>
					g2.post('/', ({ body }) => body)
				)
		)

		const send = (payload: object) =>
			app.handle(
				req('/', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload)
				})
			)

		// override: only inner `b` is required
		expect((await send({ b: 'y' })).status).toBe(200)
		// outer `a` alone is rejected (inner `b` schema won)
		expect((await send({ a: 'x' })).status).toBe(422)
	})
})
