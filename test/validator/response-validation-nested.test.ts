import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'

// Issue #1659: Response validation with nested schemas crashes with 500 instead of 422
// https://github.com/elysiajs/elysia/issues/1659
//
// Root cause: exact-mirror's Clean() function assumes valid data structure
// and throws when accessing nested properties on null values.
// Fix: Wrap Clean() calls in try-catch in dynamic-handle.ts

describe('Response validation nested schemas', () => {
	it('should return 422 for invalid nested response', async () => {
		const app = new Elysia().post(
			'/test',
			{
				body: t.Object({}),
				response: t.Object({
					items: t.Array(
						t.Tuple([
							t.String(),
							t.Union([
								t.Object({
									file: t.Object({
										ver: t.Object({
											s: t.String(),
											m: t.Nullable(t.String())
										})
									})
								})
							])
						])
					)
				})
			},
			// @ts-expect-error - intentionally returning invalid data to test validation
			() => ({
				items: [
					['t1', { file: { ver: { s: '', m: null } } }],
					['t2', { file: { ver: null } }] // Invalid
				]
			})
		)

		const res = await app.handle(
			new Request('http://localhost/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			})
		)

		expect(res.status).toBe(422)

		const json = (await res.json()) as { type: string; errors?: unknown[] }
		expect(json.type).toBe('validation')
		expect(json.errors?.length).toBeGreaterThan(0)
	})

	it('should return 422 for tuple with null nested object', async () => {
		const app = new Elysia().get(
			'/test',
			{
				response: t.Object({
					data: t.Tuple([
						t.String(),
						t.Object({
							nested: t.Object({
								value: t.String()
							})
						})
					])
				})
			},
			// @ts-expect-error - intentionally returning invalid data to test validation
			() => ({
				data: ['id', { nested: null }] // nested should be object with 'value'
			})
		)

		const res = await app.handle(new Request('http://localhost/test'))

		expect(res.status).toBe(422)

		const json = (await res.json()) as { type: string }
		expect(json.type).toBe('validation')
	})
})
