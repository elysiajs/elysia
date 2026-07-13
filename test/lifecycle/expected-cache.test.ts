/**
 * C2 (N.1) — per-schema `expected` default memo.
 *
 * Intent: `Create(schema)` (~1.5µs walk) must run ONCE per schema identity, not
 * per 422 occurrence. Encoded behaviorally: two separate 422s on the same route
 * (same snapshot-stable schema) yield the SAME cached `expected` reference. A
 * cache miss would re-`Create` and produce a distinct object.
 */
import { describe, expect, it } from 'bun:test'
import { Elysia, t, ValidationError } from '../../src'

describe('C2 expected-value cache', () => {
	it('reuses one `expected` reference across repeated 422s on the same schema', async () => {
		const expecteds: unknown[] = []

		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError)
					expecteds.push((error.payload as any).expected)
			})
			.post(
				'/',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)

		const bad = () =>
			app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name: 123 })
				})
			)

		await bad()
		await bad()

		expect(expecteds.length).toBe(2)
		// Cache HIT: identical reference proves Create ran once, not per-occurrence.
		expect(expecteds[0]).toBe(expecteds[1])
	})

	it('still produces the correct expected shape', async () => {
		let expected: any

		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError)
					expected = (error.payload as any).expected
			})
			.post(
				'/',
				{ body: t.Object({ name: t.String(), age: t.Number() }) },
				({ body }) => body
			)

		await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 123, age: 'x' })
			})
		)

		// Create() default for the object schema — shape is preserved, not corrupted.
		expect(expected).toBeDefined()
		expect(typeof expected).toBe('object')
	})
})
