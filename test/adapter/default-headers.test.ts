import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

describe('default response headers', () => {
	it('includes default headers without mutating set.headers', async () => {
		const app = new Elysia()
			.headers({ 'x-powered-by': 'elysia' })
			.get('/plain', () => 'ok')

		const response = await app.handle(new Request('http://localhost/plain'))
		expect(response.headers.get('x-powered-by')).toBe('elysia')
	})

	it('isolates request header mutations', async () => {
		const app = new Elysia()
			.headers({ 'x-default': 'default-value' })
			.get('/mutate', ({ set }) => {
				set.headers['x-custom'] = 'custom-value'
				return 'ok'
			})

		const first = await app.handle(new Request('http://localhost/mutate'))
		expect(first.headers.get('x-default')).toBe('default-value')
		expect(first.headers.get('x-custom')).toBe('custom-value')

		const second = await app.handle(new Request('http://localhost/mutate'))
		expect(second.headers.get('x-default')).toBe('default-value')
		expect(second.headers.get('x-custom')).toBe('custom-value')

		const routes = new Elysia()
			.headers({ 'x-default': 'default-value' })
			.get('/read', () => 'ok')
			.get('/mutate', ({ set }) => {
				set.headers['x-only-on-mutate'] = 'yes'
				return 'mutated'
			})

		await routes.handle(new Request('http://localhost/mutate'))

		const read = await routes.handle(new Request('http://localhost/read'))
		expect(read.headers.get('x-only-on-mutate')).toBeNull()
	})

	it('includes default headers on every unmutated request', async () => {
		const app = new Elysia()
			.headers({ 'x-app': 'test', 'x-version': '1' })
			.get('/fast', () => 'hello')

		for (let i = 0; i < 3; i++) {
			const response = await app.handle(
				new Request('http://localhost/fast')
			)
			expect(response.headers.get('x-app')).toBe('test')
			expect(response.headers.get('x-version')).toBe('1')
		}
	})
})
