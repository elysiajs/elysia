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

describe('registration footguns', () => {
	describe('group() does not inherit config.as', () => {
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

	it("guard schema default is 'override' (last guard wins)", async () => {
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
