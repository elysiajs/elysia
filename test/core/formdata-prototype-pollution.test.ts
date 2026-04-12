import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

/**
 * Helper to create a multipart/form-data POST request.
 */
const formPost = (path: string, fields: Record<string, string>) => {
	const body = new FormData()
	for (const [key, value] of Object.entries(fields)) {
		body.append(key, value)
	}
	return new Request(`http://localhost${path}`, {
		method: 'POST',
		body
	})
}

describe('FormData Prototype Pollution', () => {
	it('strips __proto__ key from JSON-parsed FormData value', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const response = await app
			.handle(
				formPost('/', {
					data: JSON.stringify({
						safe: 'value',
						__proto__: { polluted: true }
					})
				})
			)
			.then((x) => x.json())

		expect(response.data).toBeDefined()
		expect(response.data.safe).toBe('value')
		expect(Object.prototype.hasOwnProperty.call(response.data, '__proto__')).toBe(false)
		expect(response.data.polluted).toBeUndefined()
	})

	it('strips constructor key from JSON-parsed FormData value', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const response = await app
			.handle(
				formPost('/', {
					data: JSON.stringify({
						safe: 'value',
						constructor: { prototype: { polluted: true } }
					})
				})
			)
			.then((x) => x.json())

		expect(response.data.safe).toBe('value')
		expect(Object.prototype.hasOwnProperty.call(response.data, 'constructor')).toBe(false)
	})

	it('strips prototype key from JSON-parsed FormData value', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const response = await app
			.handle(
				formPost('/', {
					data: JSON.stringify({
						safe: 'value',
						prototype: { polluted: true }
					})
				})
			)
			.then((x) => x.json())

		expect(response.data.safe).toBe('value')
		expect(Object.prototype.hasOwnProperty.call(response.data, 'prototype')).toBe(false)
	})

	it('strips nested dangerous keys from deeply nested JSON', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const response = await app
			.handle(
				formPost('/', {
					data: JSON.stringify({
						level1: {
							safe: 'ok',
							__proto__: { polluted: true },
							level2: {
								constructor: { bad: true },
								value: 'kept'
							}
						}
					})
				})
			)
			.then((x) => x.json())

		expect(response.data.level1.safe).toBe('ok')
		expect(Object.prototype.hasOwnProperty.call(response.data.level1, '__proto__')).toBe(false)
		expect(response.data.level1.level2.value).toBe('kept')
		expect(Object.prototype.hasOwnProperty.call(response.data.level1.level2, 'constructor')).toBe(false)
	})

	it('skips __proto__ as a top-level FormData key', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const response = await app
			.handle(formPost('/', { __proto__: 'polluted', safe: 'ok' }))
			.then((x) => x.json())

		expect(response.safe).toBe('ok')
		// Ensure Object.prototype was not polluted
		expect(({} as any).polluted).toBeUndefined()
	})

	it('strips dangerous keys from nested key path with JSON value', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const response = await app
			.handle(
				formPost('/', {
					'user.profile': JSON.stringify({
						name: 'ok',
						__proto__: { polluted: true }
					})
				})
			)
			.then((x) => x.json())

		expect(response.user.profile.name).toBe('ok')
		expect(Object.prototype.hasOwnProperty.call(response.user.profile, '__proto__')).toBe(false)
		expect(({} as any).polluted).toBeUndefined()
	})

	it('prevents prototype pollution via constructor.prototype path', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const response = await app
			.handle(
				formPost('/', {
					'constructor.prototype': 'polluted'
				})
			)
			.then((x) => x.json())

		// The key path should be rejected since both 'constructor' and 'prototype' are dangerous
		expect(Object.prototype.hasOwnProperty.call(response, 'constructor')).toBe(false)
		expect(({} as any).polluted).toBeUndefined()
	})

	it('preserves safe data while stripping dangerous keys', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const response = await app
			.handle(
				formPost('/', {
					name: 'Alice',
					metadata: JSON.stringify({
						age: 30,
						__proto__: { admin: true },
						role: 'user'
					})
				})
			)
			.then((x) => x.json())

		expect(response.name).toBe('Alice')
		expect(response.metadata.age).toBe(30)
		expect(response.metadata.role).toBe('user')
		expect(Object.prototype.hasOwnProperty.call(response.metadata, '__proto__')).toBe(false)
		expect(({} as any).admin).toBeUndefined()
	})
})
