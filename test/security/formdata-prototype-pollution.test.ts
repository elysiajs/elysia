import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

describe('FormData prototype pollution prevention', () => {
	const app = new Elysia().post('/submit', ({ body }) => {
		return body
	})

	it('should strip __proto__ from parsed JSON in form values', async () => {
		const form = new FormData()
		form.append(
			'data',
			JSON.stringify({
				__proto__: { polluted: true },
				safe: 'value'
			})
		)

		const response = await app.handle(
			new Request('http://localhost/submit', {
				method: 'POST',
				body: form
			})
		)

		const result = (await response.json()) as Record<string, unknown>
		const data = result.data as Record<string, unknown>

		expect(data.safe).toBe('value')
		// __proto__ should not be an own enumerable property
		expect(Object.keys(data)).not.toContain('__proto__')

		// Verify Object.prototype was not polluted
		const clean: Record<string, unknown> = {}
		expect(clean).not.toHaveProperty('polluted')
	})

	it('should strip constructor and prototype keys from parsed JSON in form values', async () => {
		const form = new FormData()
		form.append(
			'data',
			JSON.stringify({
				constructor: { prototype: { polluted: true } },
				prototype: { polluted: true },
				safe: 'value'
			})
		)

		const response = await app.handle(
			new Request('http://localhost/submit', {
				method: 'POST',
				body: form
			})
		)

		const result = (await response.json()) as Record<string, unknown>
		const data = result.data as Record<string, unknown>

		expect(data.safe).toBe('value')
		expect(Object.keys(data)).not.toContain('constructor')
		expect(Object.keys(data)).not.toContain('prototype')
	})

	it('should strip __proto__ from nested objects in parsed JSON form values', async () => {
		const form = new FormData()
		form.append(
			'data',
			JSON.stringify({
				nested: {
					__proto__: { polluted: true },
					value: 'ok'
				},
				safe: 'value'
			})
		)

		const response = await app.handle(
			new Request('http://localhost/submit', {
				method: 'POST',
				body: form
			})
		)

		const result = (await response.json()) as Record<string, unknown>
		const data = result.data as Record<string, unknown>
		const nested = data.nested as Record<string, unknown>

		expect(nested.value).toBe('ok')
		expect(Object.keys(nested)).not.toContain('__proto__')

		// Verify Object.prototype was not polluted
		const clean: Record<string, unknown> = {}
		expect(clean).not.toHaveProperty('polluted')
	})

	it('should still parse valid JSON form values without dangerous keys', async () => {
		const form = new FormData()
		form.append(
			'data',
			JSON.stringify({
				name: 'test',
				count: 42,
				tags: ['a', 'b']
			})
		)

		const response = await app.handle(
			new Request('http://localhost/submit', {
				method: 'POST',
				body: form
			})
		)

		const result = (await response.json()) as Record<string, unknown>
		const data = result.data as Record<string, unknown>

		expect(data.name).toBe('test')
		expect(data.count).toBe(42)
		expect(data.tags).toEqual(['a', 'b'])
	})
})
