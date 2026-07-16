/**
 * `Create(schema)` (~1.5µs walk) must run once per schema identity, not
 * per 422 occurrence. Encoded behaviorally: two separate 422s on the same route
 * (same snapshot-stable schema) yield the SAME cached `expected` reference. A
 * cache miss would re-`Create` and produce a distinct object.
 */
import { describe, expect, it } from 'bun:test'
import { Elysia, t, ValidationError } from '../../src'

describe('validation expected-value cache', () => {
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

		// Create default for the object schema — shape is preserved, not corrupted.
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

	it('returns Create output as-is for exotic values (no clone, no cache)', () => {
		// Date is an exotic (class instance) — isCacheableExpected rejects it.
		// The fix: no structuredClone, no freeze, no cache. Each 422 re-calls
		// Create (which calls the default fn), so creates === 2. The returned
		// reference is the original Create output; prototype is intact.
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
		// exotic path: expected = created (= shared), no clone
		expect(first).toBe(shared)
		expect(second).toBe(shared)
		// not frozen — exotic values are never frozen
		expect(Object.isFrozen(first)).toBe(false)
		// prototype of the Date value is preserved (not degraded to plain object)
		expect(first.value).toBeInstanceOf(Date)
		expect(first.value.getTime()).toBe(0)
		// Create called twice — no caching for exotics
		expect(creates).toBe(2)
	})

	it('pinned: class-instance default retains prototype, is not cached, is not frozen', async () => {
		// Before the fix, structuredClone was called
		// BEFORE classification, stripping the prototype off class instances and
		// caching the degraded plain-object clone. After the fix, class instances
		// bypass clone/freeze/cache entirely.

		class Sentinel {
			readonly tag = 'sentinel'
			greet() {
				return `hello from ${this.tag}`
			}
		}

		const instance = new Sentinel()

		// t.Any with a class instance as default — Create returns the instance directly.
		const schema = t.Any({ default: instance })

		// Drive through ValidationError directly — Create returns the class
		// instance default as-is, which is the exotic case under test.
		const getExpected = () =>
			new ValidationError('body', null, [], schema).payload.expected

		const first = getExpected() as Sentinel
		const second = getExpected() as Sentinel

		// Prototype and methods remain intact rather than becoming a plain object.
		expect(first).toBeInstanceOf(Sentinel)
		expect(first.greet()).toBe('hello from sentinel')
		expect(second).toBeInstanceOf(Sentinel)
		expect(second.greet()).toBe('hello from sentinel')

		// Both calls equal `instance` because Create returns it directly, but they
		// must not become a shared frozen cache entry.
		expect(first).toBe(instance)
		expect(second).toBe(instance)

		// The original class instance remains mutable.
		expect(Object.isFrozen(first)).toBe(false)
	})
})
