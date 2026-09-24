import { Elysia, problem, t } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('problem()', () => {
	it('fills the default type and title', async () => {
		const app = new Elysia().get('/', () => problem({ status: 409 }))

		const res = await app.handle('/')

		expect(res.status).toBe(409)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		await expect(res.json()).resolves.toEqual({
			type: 'about:blank',
			title: 'Conflict',
			status: 409
		})
	})

	it('accepts a StatusMap name and normalizes it to the numeric code', async () => {
		const app = new Elysia().get('/', () => problem({ status: 'Conflict' }))

		const res = await app.handle('/')

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

		const res = await app.handle('/')

		expect(res.status).toBe(409)
		await expect(res.json()).resolves.toEqual({
			type: 'out-of-stock',
			title: 'Out of stock',
			status: 409,
			detail: 'SKU 42 is gone',
			sku: 42
		})
	})

	it('accepts status and detail as separate arguments', async () => {
		const app = new Elysia().get('/', () =>
			problem(409, {
				detail: 'SKU 42 is gone',
				sku: 42
			})
		)

		const res = await app.handle('/')

		expect(res.status).toBe(409)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		await expect(res.json()).resolves.toEqual({
			type: 'about:blank',
			title: 'Conflict',
			status: 409,
			detail: 'SKU 42 is gone',
			sku: 42
		})
	})

	it('serializes a thrown problem without an error hook', async () => {
		const app = new Elysia().get('/', () => {
			throw problem({ status: 418, detail: 'teapot' })
		})

		const res = await app.handle('/')

		expect(res.status).toBe(418)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		await expect(res.json()).resolves.toMatchObject({
			status: 418,
			detail: 'teapot'
		})
	})

	it('serializes a thrown problem through an error hook', async () => {
		const app = new Elysia()
			.error(() => {})
			.get('/', () => {
				throw problem({ status: 418, detail: 'teapot' })
			})

		const res = await app.handle('/')

		expect(res.status).toBe(418)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		await expect(res.json()).resolves.toMatchObject({
			status: 418,
			detail: 'teapot'
		})
	})

	it('serializes a problem returned by an error hook', async () => {
		const app = new Elysia()
			.error(({ error }: { error: unknown }) =>
				problem({ status: 500, detail: (error as Error).message })
			)
			.get('/', () => {
				throw new Error('kaboom')
			})

		const res = await app.handle('/')

		expect(res.status).toBe(500)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		await expect(res.json()).resolves.toMatchObject({
			type: 'about:blank',
			status: 500,
			detail: 'kaboom'
		})
	})
})

describe('context problem', () => {
	it('is available on the handler context', async () => {
		const app = new Elysia().get('/', ({ problem }) =>
			problem(409, { detail: 'x' })
		)

		const res = await app.handle('/')

		expect(res.status).toBe(409)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		await expect(res.json()).resolves.toEqual({
			type: 'about:blank',
			title: 'Conflict',
			status: 409,
			detail: 'x'
		})
	})

	// `problemBody` fills type/title/status, so a `t.Problem()` response schema
	// must accept that body without the caller restating them
	it('satisfies a t.Problem response schema', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					409: t.Problem({ sku: t.Number() })
				}
			},
			({ problem }) => problem(409, { sku: 42 })
		)

		const res = await app.handle('/')

		expect(res.status).toBe(409)
		await expect(res.json()).resolves.toEqual({
			type: 'about:blank',
			title: 'Conflict',
			status: 409,
			sku: 42
		})
	})

	// `code` is the machine-readable token, it must survive response encoding
	it('keeps an explicit code', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					409: t.Problem({ sku: t.Number() })
				}
			},
			({ problem }) => problem(409, { sku: 42, code: 'oos' })
		)

		const res = await app.handle('/')

		expect(res.status).toBe(409)
		await expect(res.json()).resolves.toEqual({
			type: 'about:blank',
			code: 'oos',
			title: 'Conflict',
			status: 409,
			sku: 42
		})
	})

	it('fails response validation on a mistyped extension member', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					409: t.Problem({ sku: t.Number() })
				}
			},
			({ problem }) => problem(409, { sku: 'nope' } as any)
		)

		const res = await app.handle('/')

		// Response validation failures are server errors.
		expect(res.status).toBe(500)
	})
})
