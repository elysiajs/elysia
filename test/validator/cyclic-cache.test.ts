import { afterEach, describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'

// The validator cache shares one validator between structurally equal schemas
// unless a node is opaque (a refine or codec only identity can tell apart).
// t.Cyclic keeps its schemas under `$defs`, which the cache walk skipped: a
// refined and a plain cyclic schema shared a validator, so whichever route
// compiled first decided whether the other one ran the refinement

afterEach(() => Validator.clear())

const json = (body: unknown) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
})

describe('t.Cyclic in the validator cache', () => {
	for (const order of [
		['/plain', '/refined'],
		['/refined', '/plain']
	])
		it(`keeps a refine inside $defs to its own route (${order[0]} first)`, async () => {
			const node = (refined: boolean) =>
				t.Cyclic(
					{
						Q: t.Object({
							s: refined
								? t.Refine(
										t.String(),
										(value) => value.length > 3,
										() => 'too short'
									)
								: t.String()
						})
					},
					'Q'
				)

			const app = new Elysia()
				.post('/plain', { body: node(false) }, () => 'ok')
				.post('/refined', { body: node(true) }, () => 'ok')

			const status: Record<string, number> = {}
			for (const path of order)
				status[path] = (
					await app.handle(
						new Request(
							'http://localhost' + path,
							json({ s: 'ab' })
						)
					)
				).status

			expect(status).toEqual({ '/plain': 200, '/refined': 422 })
		})

	for (const order of [
		['/plain', '/refined'],
		['/refined', '/plain']
	])
		it(`keeps a refine on a cyclic query root to its own route (${order[0]} first)`, async () => {
			const node = (refined: boolean) =>
				t.Cyclic(
					{
						Q: refined
							? t.Refine(
									t.Object({ n: t.Number() }),
									(value) => value.n > 5,
									() => 'must be above 5'
								)
							: t.Object({ n: t.Number() })
					},
					'Q'
				)

			const app = new Elysia()
				.get('/plain', { query: node(false) }, () => 'ok')
				.get('/refined', { query: node(true) }, () => 'ok')

			const status: Record<string, number> = {}
			for (const path of order)
				status[path] = (
					await app.handle(new Request(`http://localhost${path}?n=1`))
				).status

			expect(status).toEqual({ '/plain': 200, '/refined': 422 })
		})
})
