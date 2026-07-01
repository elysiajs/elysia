import { Elysia, problem } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

// RFC 9457 problem+json authoring helper. `problem()` wraps ElysiaStatus so it
// works in return, throw, and onError positions and always emits
// `application/problem+json`.
describe('problem()', () => {
	it('returns problem+json with defaults filled', async () => {
		const app = new Elysia().get('/', () => problem({ status: 409 }))

		const res = await app.handle(req('/'))

		expect(res.status).toBe(409)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		// `type` defaults to about:blank, `title` to the HTTP status phrase
		await expect(res.json()).resolves.toEqual({
			type: 'about:blank',
			title: 'Conflict',
			status: 409
		})
	})

	it('accepts a StatusMap name and normalizes it to the numeric code', async () => {
		const app = new Elysia().get('/', () =>
			problem({ status: 'Conflict' })
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(409)
		await expect(res.json()).resolves.toEqual({
			type: 'about:blank',
			title: 'Conflict',
			status: 409
		})
	})

	it('keeps custom type/title/detail and extension members', async () => {
		const app = new Elysia().get('/', () =>
			problem({
				status: 409,
				type: 'out-of-stock',
				title: 'Out of stock',
				detail: 'SKU 42 is gone',
				sku: 42
			})
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(409)
		await expect(res.json()).resolves.toEqual({
			type: 'out-of-stock',
			title: 'Out of stock',
			status: 409,
			detail: 'SKU 42 is gone',
			sku: 42
		})
	})

	it('works when thrown on a plain route (interpreted error path)', async () => {
		const app = new Elysia().get('/', () => {
			throw problem({ status: 418, detail: 'teapot' })
		})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(418)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		await expect(res.json()).resolves.toMatchObject({
			status: 418,
			detail: 'teapot'
		})
	})

	it('works when thrown on a route with an error hook (AOT codegen path)', async () => {
		const app = new Elysia()
			// forces the compiled error catch block
			.error(() => {})
			.get('/', () => {
				throw problem({ status: 418, detail: 'teapot' })
			})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(418)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		await expect(res.json()).resolves.toMatchObject({
			status: 418,
			detail: 'teapot'
		})
	})

	it('works when returned from onError', async () => {
		const app = new Elysia()
			.error(({ error }: { error: unknown }) =>
				problem({ status: 500, detail: (error as Error).message })
			)
			.get('/', () => {
				throw new Error('kaboom')
			})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		await expect(res.json()).resolves.toMatchObject({
			type: 'about:blank',
			status: 500,
			detail: 'kaboom'
		})
	})
})
