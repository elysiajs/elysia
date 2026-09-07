import { Elysia, t, ValidationError } from '../../src'
import { MAX_ERRORS } from '../../src/error'

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
})
