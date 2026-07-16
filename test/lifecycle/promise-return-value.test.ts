import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

// Regression coverage for  : Promise handling must depend on the
// *returned value*, not on function syntax. A hook (or Standard Schema) whose
// synchronous body returns `new Promise(...)` must be awaited before the
// framework decides whether to short-circuit. Previously the raw thenable was
// treated as a truthy short-circuit response and produced an empty 200/500.
//
// Each test asserts the intended lifecycle outcome (continue to handler / emit
// the real error) — a plain `expect(status).toBe(200)` alone would still pass
// against the buggy empty-200, so the body is asserted too.
describe('Promise-returning hooks', () => {
	it('.request() returning a Promise<undefined> continues to the handler', async () => {
		const app = new Elysia()
			// resolves to undefined -> must NOT short-circuit; the raw Promise
			// must not be treated as a response
			.request(() => new Promise<void>((resolve) => resolve()) as any)
			.get('/', () => 'handler')

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('handler')
	})

	it('.request() returning a resolved value short-circuits with that value', async () => {
		const app = new Elysia()
			.request(() => new Promise<string>((resolve) => resolve('early')))
			.get('/', () => 'handler')

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('early')
	})

	it('beforeHandle returning a Promise<undefined> reaches the handler', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle: () =>
					new Promise<void>((resolve) => resolve()) as any
			},
			() => 'handler'
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('handler')
	})

	it('beforeHandle returning a resolved value short-circuits with that value', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle: () =>
					new Promise<string>((resolve) => resolve('before'))
			},
			() => 'handler'
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('before')
	})

	it('error hook returning a Promise<undefined> falls back to the real error', async () => {
		const app = new Elysia()
			// resolves to undefined -> must NOT suppress the fallback error
			.error(() => new Promise<void>((resolve) => resolve()) as any)
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		// the real error detail must survive, not an empty body
		const body = await res.text()
		expect(body).not.toBe('')
		expect(body).toContain('boom')
	})

	it('error hook returning a resolved value uses that as the error response', async () => {
		const app = new Elysia()
			.error(() => new Promise<string>((resolve) => resolve('handled')))
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('handled')
	})

	it('Standard Schema response whose sync validate() returns a Promise is awaited', async () => {
		// A spec-valid Standard Schema may return a Promise from a validate()
		// that is *not* declared async. StandardValidator.mayReturnPromise is
		// true, so response validation must be permitted to run asynchronously
		// instead of throwing / serializing the raw thenable at 200.
		const promiseSchema: any = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) =>
					new Promise((resolve) => resolve({ value }))
			}
		}

		const app = new Elysia().get(
			'/',
			{ response: promiseSchema },
			() => ({ ok: true })
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ ok: true })
	})
})
