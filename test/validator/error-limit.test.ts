import { Elysia, t, ValidationError } from '../../src'
import {
	MAX_ERRORS,
	MAX_VALIDATION_ERROR_OUTPUT_LENGTH,
	MAX_VALIDATION_ERROR_STRING_LENGTH
} from '../../src/error'

import { describe, expect, it } from 'bun:test'
import { post } from '../utils'

// ? Reported as GHSA-46qc
//
// ? The amount of error a schema produce is bound to the size of the value
// ? being validated. Reporting every error let a small request produce an
// ? arbitrarily large response, and materialize an error object for every
// ? element of the value while doing so
describe('Validation Error Limit', () => {
	const body = t.Object({ data: t.Array(t.String()) })

	const invalid = (n: number) =>
		post('/', { data: Array.from({ length: n }, (_, i) => i) })

	it('caps the amount of error reported in the response', async () => {
		const app = new Elysia().post('/', ({ body }) => body, { body })

		const response = await app.handle(invalid(1000))
		const value = JSON.parse(await response.text())

		expect(response.status).toBe(422)
		expect(value.errors.length).toBeLessThanOrEqual(MAX_ERRORS)
	})

	it('does not report more error as the value grows', async () => {
		const app = new Elysia().post('/', ({ body }) => body, { body })

		const small = JSON.parse(
			await (await app.handle(invalid(MAX_ERRORS * 2))).text()
		)
		const large = JSON.parse(
			await (await app.handle(invalid(50_000))).text()
		)

		// ? Both are past the limit, so several orders of magnitude more
		// ? invalid element must not produce a larger error list
		expect(small.errors.length).toBe(MAX_ERRORS)
		expect(large.errors.length).toBe(small.errors.length)
	})

	it('caps the amount of error reported by `all`', async () => {
		const app = new Elysia()
			.onError(({ code, error }) => {
				if (code === 'VALIDATION') return { errors: error.all }
			})
			.post('/', ({ body }) => body, { body })

		const value = (await (await app.handle(invalid(50_000))).json()) as any

		expect(value.errors.length).toBeLessThanOrEqual(MAX_ERRORS)
	})

	it('stops reading the value instead of materializing every error', () => {
		let read = 0

		const data = new Proxy(
			Array.from({ length: 50_000 }, (_, i) => i),
			{
				get(target, key, receiver) {
					if (typeof key === 'string' && !isNaN(+key)) read++

					return Reflect.get(target, key, receiver)
				}
			}
		)

		const error = new ValidationError('body', body, { data })

		// ? `Value.Errors` is lazy, so the error list must be taken from the
		// ? iterator rather than spread into an array and sliced afterward
		read = 0
		expect(error.all.length).toBeLessThanOrEqual(MAX_ERRORS)
		expect(read).toBeLessThanOrEqual(MAX_ERRORS)
	})

	it('reports every error when below the limit', async () => {
		const app = new Elysia()
			.onError(({ code, error }) => {
				if (code === 'VALIDATION') return { errors: error.all }
			})
			.post('/', ({ body }) => body, {
				body: t.Object({
					username: t.String(),
					password: t.String()
				})
			})

		const value = (await (await app.handle(post('/', {}))).json()) as any

		// ? Capping must not truncate an error list a schema of this size
		// ? would produce anyway
		expect(value.errors.length).toBe(2)
		expect(value.errors.map((x: any) => x.path)).toEqual([
			'/username',
			'/password'
		])
	})

	it('preserves ordinary TypeBox validation output', () => {
		const error = new ValidationError(
			'body',
			t.Object({ name: t.String() }),
			{ name: 1 }
		)

		expect(error.message).toBe(
			JSON.stringify(
				{
					type: 'validation',
					on: 'body',
					property: '/name',
					message: 'Expected string',
					summary:
						"Expected property 'name' to be string but found: 1",
					expected: { name: '' },
					found: { name: 1 },
					errors: [
						{
							type: 54,
							schema: { type: 'string' },
							path: '/name',
							value: 1,
							message: 'Expected string',
							errors: [],
							summary:
								"Expected property 'name' to be string but found: 1"
						}
					]
				},
				null,
				2
			)
		)
	})

	it('preserves ordinary Standard Schema validation output', () => {
		const validator = {
			'~standard': {
				validate: () => ({
					issues: [
						{
							message: 'Expected string',
							path: ['name'],
							problem: 'bad'
						}
					]
				})
			}
		}
		const error = new ValidationError('body', validator as any, { name: 1 })

		expect(error.message).toBe(
			JSON.stringify(
				{
					type: 'validation',
					on: 'body',
					property: 'name',
					message: 'Expected string',
					summary: 'bad',
					found: { name: 1 }
				},
				null,
				2
			)
		)
	})

	it('bounds deep, wide, sparse, and large values', () => {
		let deep: any = 'value'
		for (let i = 0; i < 1000; i++) deep = { deep }

		const wide: Record<string, unknown> = {}
		for (let i = 0; i < 2000; i++) wide[`key-${i}`] = i

		const sparse: unknown[] = []
		sparse.length = 100_000_000
		sparse[99_999_999] = 'last'

		for (const value of [
			deep,
			wide,
			sparse,
			'x'.repeat(MAX_VALIDATION_ERROR_OUTPUT_LENGTH * 2)
		]) {
			const error = new ValidationError('body', t.String(), value)

			expect(error.message.length).toBeLessThanOrEqual(
				MAX_VALIDATION_ERROR_OUTPUT_LENGTH
			)
			expect(() => JSON.parse(error.message)).not.toThrow()
		}
	})

	it('serializes cycles and BigInt without throwing', () => {
		const value: any = { id: 1n }
		value.self = value

		const error = new ValidationError('body', t.String(), value)
		const message = JSON.parse(error.message)

		expect(message.found).toEqual({
			id: '[BigInt]',
			self: '[Circular]'
		})
	})

	it('does not invoke getters or toJSON while formatting errors', () => {
		let getterCalls = 0
		let issueGetterCalls = 0
		let toJSONCalls = 0
		const value = Object.create(null)

		Object.defineProperties(value, {
			visible: {
				value: 'ok',
				enumerable: true
			},
			secret: {
				get() {
					getterCalls++
					throw new Error('getter called')
				},
				enumerable: true
			},
			toJSON: {
				value() {
					toJSONCalls++
					throw new Error('toJSON called')
				},
				enumerable: true
			}
		})

		const error = new ValidationError('body', t.String(), value)
		const message = JSON.parse(error.message)
		const issue = Object.create(null)
		Object.defineProperty(issue, 'message', {
			get() {
				issueGetterCalls++
				throw new Error('issue getter called')
			},
			enumerable: true
		})
		const standardError = new ValidationError(
			'body',
			{
				'~standard': {
					validate: () => ({ issues: [issue] })
				}
			} as any,
			value
		)

		expect(getterCalls).toBe(0)
		expect(issueGetterCalls).toBe(0)
		expect(toJSONCalls).toBe(0)
		expect(() => JSON.parse(standardError.message)).not.toThrow()
		expect(message.found).toEqual({
			visible: 'ok',
			secret: '[Unserializable]'
		})
	})

	it('bounds custom errors and detail output', () => {
		const value = {
			data: 'x'.repeat(MAX_VALIDATION_ERROR_OUTPUT_LENGTH * 2)
		}
		const error = new ValidationError(
			'body',
			t.String({
				error: 'x'.repeat(MAX_VALIDATION_ERROR_OUTPUT_LENGTH * 2)
			}),
			value,
			true
		)
		const detail = error.detail(error.message, true)
		const serialized = JSON.stringify(detail)

		expect(error.message.length).toBe(MAX_VALIDATION_ERROR_STRING_LENGTH)
		expect(serialized.length).toBeLessThanOrEqual(
			MAX_VALIDATION_ERROR_OUTPUT_LENGTH
		)
		expect(() => JSON.parse(serialized)).not.toThrow()
	})

	it('keeps ordinary detail containers usable', () => {
		const error = new ValidationError(
			'body',
			t.Object({ name: t.String({ error: 'invalid name' }) }),
			{ name: 1 }
		)
		const detail = error.detail(error.message) as any

		expect(Object.getPrototypeOf(detail)).toBe(Object.prototype)
		expect(Array.isArray(detail.errors)).toBe(true)
		expect(detail.errors.map((item: any) => item.path)).toEqual(['/name'])
	})

	it('caps the UTF-8 response size', () => {
		const value = {
			data: Array.from({ length: 32 }, () => '€'.repeat(4096))
		}
		const error = new ValidationError('body', t.String(), value)

		expect(
			new TextEncoder().encode(error.message).length
		).toBeLessThanOrEqual(MAX_VALIDATION_ERROR_OUTPUT_LENGTH)
		expect(() => JSON.parse(error.message)).not.toThrow()
	})

	it('preserves ordinary array values in summaries', () => {
		const error = new ValidationError(
			'body',
			t.Object({ name: t.String() }),
			{ name: [1, 2] }
		)

		expect(JSON.parse(error.message).summary).toEndWith('found: 1,2')
	})

	it('handles throwing proxies and bounded Standard Schema paths', () => {
		const throwingProxy = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error('getPrototypeOf called')
				}
			}
		)

		expect(() => {
			new ValidationError('body', t.String(), throwingProxy)
		}).not.toThrow()

		const issue = {
			message: 'invalid',
			path: Array.from({ length: 10_000 }, () => 'segment'.repeat(100))
		}
		const error = new ValidationError(
			'body',
			{
				'~standard': {
					validate: () => ({ issues: [issue] })
				}
			} as any,
			{},
			true
		)
		const serialized = JSON.stringify(error.detail(error.message, true))

		expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(
			MAX_VALIDATION_ERROR_OUTPUT_LENGTH
		)
	})
})
