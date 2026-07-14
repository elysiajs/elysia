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
	it('reuses one deeply frozen `expected` value without cross-request mutation', async () => {
		const expecteds: any[] = []
		let mutationApplied: boolean | undefined

		const app = new Elysia()
			.error(({ error }) => {
				if (!(error instanceof ValidationError)) return

				const expected = (error.payload as any).expected
				expecteds.push(expected)
				if (expecteds.length === 1)
					mutationApplied = Reflect.set(
						expected.profile,
						'name',
						'poisoned'
					)
			})
			.post(
				'/',
				{
					body: t.Object({
						profile: t.Object({ name: t.String() })
					})
				},
				({ body }) => body
			)

		const bad = () =>
			app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ profile: { name: 123 } })
				})
			)

		await bad()
		await bad()

		expect(expecteds.length).toBe(2)
		expect(expecteds[0]).toBe(expecteds[1])
		expect(Object.isFrozen(expecteds[0])).toBe(true)
		expect(Object.isFrozen(expecteds[0].profile)).toBe(true)
		expect(mutationApplied).toBe(false)
		expect(expecteds[1].profile.name).toBe('')
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

	it('does not freeze objects returned by user default functions', () => {
		const shared = { profile: { name: 'Airi' } }
		const schema = t.Any({ default: () => shared })
		const expected = new ValidationError('body', null, [], schema).payload
			.expected as typeof shared

		expect(expected).not.toBe(shared)
		expect(Object.isFrozen(expected)).toBe(true)
		expect(Object.isFrozen(expected.profile)).toBe(true)
		expect(Object.isFrozen(shared)).toBe(false)
		expect(Object.isFrozen(shared.profile)).toBe(false)
	})

	it('preserves expected when cloning a default fails', () => {
		let creates = 0
		let cloneAttempts = 0
		const shared = {
			get value() {
				cloneAttempts++
				return () => 'not cloneable'
			}
		}
		const schema = t.Any({
			default: () => {
				creates++
				return shared
			}
		})
		const expected = () =>
			new ValidationError('body', null, [], schema).payload.expected

		expect(expected()).toBe(shared)
		expect(expected()).toBe(shared)
		expect(creates).toBe(2)
		expect(cloneAttempts).toBe(2)
	})

	it('isolates fresh snapshots that cannot be deeply frozen', () => {
		let creates = 0
		const shared = { value: new Date(0) }
		const schema = t.Any({
			default: () => {
				creates++
				return shared
			}
		})
		const expected = () =>
			new ValidationError('body', null, [], schema).payload.expected

		const first = expected() as typeof shared
		const second = expected() as typeof shared
		expect(first).not.toBe(shared)
		expect(second).not.toBe(shared)
		expect(second).not.toBe(first)
		expect(first.value).not.toBe(shared.value)
		expect(first.value.getTime()).toBe(0)
		expect(creates).toBe(2)
	})
})
