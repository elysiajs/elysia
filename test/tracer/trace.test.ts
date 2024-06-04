import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('trace', () => {
	it('inherits plugin', async () => {
		const timeout = setTimeout(() => {
			throw new Error('Trace stuck')
		}, 1000)

		const a = new Elysia().trace({ as: 'global' }, async ({ set }) => {
			set.headers['X-Powered-By'] = 'elysia'
			clearTimeout(timeout)
		})

		const app = new Elysia().use(a).get('/', () => 'hi')

		const response = await app.handle(req('/'))

		expect(response.headers.get('X-Powered-By')).toBe('elysia')
		expect(response.status).toBe(200)
	})

	it('handle scoped instance', async () => {
		const timeout = setTimeout(() => {
			throw new Error('Trace stuck')
		}, 1000)

		const a = new Elysia().trace({ as: 'global' }, async ({ set }) => {
			set.headers['X-Powered-By'] = 'elysia'
			clearTimeout(timeout)
		})

		const b = new Elysia({ scoped: true }).get('/scoped', () => 'hi')

		const app = new Elysia()
			.use(a)
			.use(b)
			.get('/', () => 'hi')

		const response = await app.handle(req('/scoped'))

		expect(response.headers.get('X-Powered-By')).toBe('elysia')
		expect(response.status).toBe(200)
	})
})
