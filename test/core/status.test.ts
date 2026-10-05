import { describe, it, expect } from 'bun:test'

import Elysia, { ElysiaStatus, HTTPError, problem, status, t } from '../../src'

describe('Status', () => {
	it('work', async () => {
		const app = new Elysia().get('/', ({ status }) => status(201))

		const response = await app.handle('/')

		expect(response.status).toBe(201)
		await expect(response.text()).resolves.toBe('Created')
	})

	// Bun support 101 or >= 200 status
	it('ignore response body of 101', async () => {
		const app = new Elysia().get('/', ({ status }) => status(101))

		const response = await app.handle('/')

		expect(response.status).toBe(101)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 101', async () => {
		const app = new Elysia().get('/', ({ status }) => status(101, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(101)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 204', async () => {
		const app = new Elysia().get('/', ({ status }) => status(204))

		const response = await app.handle('/')

		expect(response.status).toBe(204)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 204', async () => {
		const app = new Elysia().get('/', ({ status }) => status(204, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(204)
		await expect(response.text()).resolves.toBe('')
	})

	// The body is dropped, so a problem+json `content-type` would describe
	// nothing and send a client (Eden) parsing JSON out of an empty body
	describe('drop the content-type along with the body', () => {
		class NoContent extends HTTPError.id('NO_CONTENT', 204) {
			headers = { 'x-trace': 'kept' }
		}

		class NotModified extends HTTPError.id('NOT_MODIFIED', 304) {}

		// Shared and frozen: the constructor has to copy, not delete in place
		const shared = Object.freeze({
			'content-type': 'application/problem+json',
			'x-trace': 'kept'
		})

		const app = new Elysia()
			.get('/problem', () => problem(204))
			.get('/thrown', () => {
				throw new NoContent()
			})
			.get('/returned', () => new NoContent())
			.get('/not-modified', () => {
				throw new NotModified()
			})
			.get('/shared', () => new ElysiaStatus(204, undefined, shared))
			// Header names are case-insensitive, every spelling describes the body
			.get(
				'/mixed-case',
				() =>
					new ElysiaStatus(204, undefined, {
						'Content-Type': 'application/json',
						'x-trace': 'kept'
					})
			)
			.get(
				'/duplicate-casing',
				() =>
					new ElysiaStatus(205, undefined, {
						'content-type': 'application/json',
						'Content-Type': 'application/json',
						'CONTENT-TYPE': 'application/json',
						'x-trace': 'kept'
					})
			)
			.get(
				'/mixed-case-304',
				() =>
					new ElysiaStatus(304, undefined, {
						'Content-Type': 'application/json',
						'x-trace': 'kept'
					})
			)

		for (const [path, code] of [
			['/problem', 204],
			['/thrown', 204],
			['/returned', 204],
			['/not-modified', 304],
			['/shared', 204],
			['/mixed-case', 204],
			['/duplicate-casing', 205],
			['/mixed-case-304', 304]
		] as const)
			it(path, async () => {
				const response = await app.handle(path)

				expect(response.status).toBe(code)
				expect(response.headers.get('content-type')).toBeNull()
				await expect(response.text()).resolves.toBe('')
			})

		it('keep every other header', async () => {
			for (const path of [
				'/thrown',
				'/returned',
				'/shared',
				'/mixed-case',
				'/duplicate-casing',
				'/mixed-case-304'
			]) {
				const response = await app.handle(path)

				expect(response.headers.get('x-trace')).toBe('kept')
			}

			expect(shared['content-type']).toBe('application/problem+json')
		})
	})

	it('ignore response body of 205', async () => {
		const app = new Elysia().get('/', ({ status }) => status(205))

		const response = await app.handle('/')

		expect(response.status).toBe(205)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 205', async () => {
		const app = new Elysia().get('/', ({ status }) => status(205, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(205)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 304', async () => {
		const app = new Elysia().get('/', ({ status }) => status(304))

		const response = await app.handle('/')

		expect(response.status).toBe(304)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 304', async () => {
		const app = new Elysia().get('/', ({ status }) => status(304, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(304)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 307', async () => {
		const app = new Elysia().get('/', ({ status }) => status(307))

		const response = await app.handle('/')

		expect(response.status).toBe(307)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 307', async () => {
		const app = new Elysia().get('/', ({ status }) => status(307, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(307)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore response body of 308', async () => {
		const app = new Elysia().get('/', ({ status }) => status(308))

		const response = await app.handle('/')

		expect(response.status).toBe(308)
		await expect(response.text()).resolves.toBe('')
	})

	it('ignore explicit response body of 308', async () => {
		const app = new Elysia().get('/', ({ status }) => status(308, 'Hello'))

		const response = await app.handle('/')

		expect(response.status).toBe(308)
		await expect(response.text()).resolves.toBe('')
	})

	// The numeric field is `status`, not `code`: `code` is now the string
	// token an error serves, and one module can't spell both with one word.
	// A name is resolved on the way in, so the field is always the number
	it('carry the resolved number on `status`', () => {
		const named = status('Payment Required', 'nope')

		expect(named.status).toBe(402)
		expect(named.response).toBe('nope')
		expect(named).not.toHaveProperty('code')

		expect(status(201).status).toBe(201)
		// an empty status still resolves, it only drops the body
		expect(status(204).status).toBe(204)
		expect(status(204).response).toBeUndefined()
	})

	// The rename cost `ElysiaStatus` its structural discriminator — `status` +
	// `response` is a shape a handler may write by hand, so a type-only brand
	// keeps a plain literal out of the status lane
	it('serve a hand-written status-shaped object as a plain body', async () => {
		const app = new Elysia().get(
			'/',
			() => ({ status: 401, response: 'c' }) as const
		)

		const response = await app.handle('/')

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			status: 401,
			response: 'c'
		})
	})
})
