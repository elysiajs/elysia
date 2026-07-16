import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { ValidationError } from '../../src/error'
import { req } from '../utils'

describe('runtime error responses', () => {
	it('uses .error(Error, handler) as a catch-all class mapping', async () => {
		const app = new Elysia()
			.error(Error, ({ error }) => `caught: ${(error as Error).message}`)
			.get('/boom', () => {
				throw new Error('kaboom')
			})

		const response = await app.handle(req('/boom'))
		expect(await response.text()).toBe('caught: kaboom')
	})

	it('includes the malformed JSON cause in a non-production 400 response', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ x: t.Number() }) },
			({ body }) => body
		)

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{invalid json'
			})
		)

		expect(response.status).toBe(400)
		const body = (await response.json()) as any
		expect(typeof body.detail).toBe('string')
		expect(body.detail.length).toBeGreaterThan(0)
	})

	it('returns one public numeric-coercion error without schema internals', async () => {
		const app = new Elysia().get(
			'/x',
			{ query: t.Object({ page: t.Number() }) },
			({ query }) => query
		)

		const response = await app.handle(req('/x?page=abc'))
		expect(response.status).toBe(422)

		const body = (await response.json()) as any
		expect(body.errors).toHaveLength(1)
		expect(JSON.stringify(body)).not.toContain('~refine')
		expect(JSON.stringify(body)).not.toContain('anyOf')
		expect(body.errors[0].message).toBe('must be number')
	})

	it('evaluates lazy ValidationError details once across accessors', () => {
		let calls = 0
		const error = new ValidationError('body', { x: 1 }, () => {
			calls++
			return [{ instancePath: '/x', message: 'nope' }]
		})

		expect(calls).toBe(0)
		expect(error.message).toBe('nope')
		expect(error.errors).toHaveLength(1)
		expect(error.customError).toBeUndefined()
		expect(calls).toBe(1)
	})
})
