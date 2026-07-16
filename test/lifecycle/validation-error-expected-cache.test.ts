import { describe, expect, it } from 'bun:test'

import { Elysia, t, ValidationError } from '../../src'
import { post } from '../utils'

describe('ValidationError expected values', () => {
	it('caches and deeply freezes expected values by schema', async () => {
		type Expected = { profile: { name: string } }
		const expectedValues: Expected[] = []
		let mutationApplied: boolean | undefined

		const app = new Elysia()
			.error(({ error }) => {
				if (!(error instanceof ValidationError)) return

				const expected = error.payload.expected as Expected
				expectedValues.push(expected)
				if (expectedValues.length === 1)
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

		await app.handle(post('/', { profile: { name: 123 } }))
		await app.handle(post('/', { profile: { name: 123 } }))

		expect(expectedValues).toHaveLength(2)
		expect(expectedValues[0]).toBe(expectedValues[1])
		expect(Object.isFrozen(expectedValues[0])).toBe(true)
		expect(Object.isFrozen(expectedValues[0].profile)).toBe(true)
		expect(mutationApplied).toBe(false)
		expect(expectedValues[1].profile.name).toBe('')
	})

	it('creates expected values from the validation schema', async () => {
		let expected: unknown

		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError)
					expected = error.payload.expected
			})
			.post(
				'/',
				{ body: t.Object({ name: t.String(), age: t.Number() }) },
				({ body }) => body
			)

		await app.handle(post('/', { name: 123, age: 'x' }))

		expect(expected).toEqual({ name: '', age: 0 })
	})

	it('freezes a clone without freezing objects returned by default functions', () => {
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

	it('returns uncloneable defaults by identity without freezing or caching', () => {
		type Default = { sequence: number }
		const created: Default[] = []
		const schema = t.Any({
			default: () => {
				const value = new Proxy({ sequence: created.length + 1 }, {})
				created.push(value)
				return value
			}
		})
		const expected = () =>
			new ValidationError('body', null, [], schema).payload
				.expected as Default

		const first = expected()
		const second = expected()

		expect(first).toBe(created[0])
		expect(second).toBe(created[1])
		expect(first).not.toBe(second)
		expect(Object.isFrozen(first)).toBe(false)
		expect(Object.isFrozen(second)).toBe(false)
		expect(() => structuredClone(first)).toThrow()
	})

	describe('non-plain defaults', () => {
		it('preserves nested Date values without cloning, freezing, or caching', () => {
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

			expect(first).toBe(shared)
			expect(second).toBe(shared)
			expect(Object.isFrozen(first)).toBe(false)
			expect(first.value).toBeInstanceOf(Date)
			expect(first.value.getTime()).toBe(0)
			expect(creates).toBe(2)
		})

		it('preserves a root class-instance default by identity without freezing it', () => {
			class Sentinel {
				readonly tag = 'sentinel'

				greet() {
					return `hello from ${this.tag}`
				}
			}

			const instance = new Sentinel()
			const schema = t.Any({ default: instance })
			const expected = () =>
				new ValidationError('body', null, [], schema).payload.expected

			const first = expected() as Sentinel
			const second = expected() as Sentinel

			expect(first).toBeInstanceOf(Sentinel)
			expect(first.greet()).toBe('hello from sentinel')
			expect(second).toBeInstanceOf(Sentinel)
			expect(second.greet()).toBe('hello from sentinel')
			expect(first).toBe(instance)
			expect(second).toBe(instance)
			expect(Object.isFrozen(first)).toBe(false)
		})
	})
})
