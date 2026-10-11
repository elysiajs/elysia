import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { isProduction } from '../../src/error'

// Regression for #1659: nested response validation crashed in Clean().
// https://github.com/elysiajs/elysia/issues/1659

describe('Response validation nested schemas', () => {
	it('should reject an invalid nested response instead of crashing', async () => {
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

		expect(res.status).toBe(500)

		const json = (await res.json()) as {
			type: string
			on?: string
			name?: string
			errors?: unknown[]
		}
		expect(json.type).toBe('internal-server-error')
		// A Clean() crash includes the thrown TypeError name.
		expect(json.name).toBeUndefined()

		if (!isProduction()) {
			expect(json.on).toBe('response')
			expect(json.errors?.length).toBeGreaterThan(0)
		}
	})

	it('should reject a tuple with a null nested object instead of crashing', async () => {
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

		expect(res.status).toBe(500)

		const json = (await res.json()) as {
			type: string
			on?: string
			name?: string
		}
		expect(json.type).toBe('internal-server-error')
		expect(json.name).toBeUndefined()

		if (!isProduction()) expect(json.on).toBe('response')
	})
})
