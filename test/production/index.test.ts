import { Elysia, t } from '../../src'
import { mapCompactResponse } from '../../src/adapter/web-standard/handler'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

describe('NODE_ENV=production', () => {
	beforeEach(() => {
		process.env.NODE_ENV = 'production'
	})

	afterEach(() => {
		delete process.env.NODE_ENV
	})

	it('omit error summary', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					name: t.String()
				})
			},
			() => 'yay'
		)

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: ''
			})
		)

		const text = await response.text()
		expect(text).not.toEqual(
			'Right side of assignment cannot be destructured'
		)
	})

	it('keeps request-hook path own and enumerable', async () => {
		let own = false
		let enumerable = false
		const app = new Elysia()
			.request((context) => {
				own = Object.hasOwn(context, 'path')
				enumerable = Object.keys(context).includes('path')
			})
			.get('/', () => 'ok')

		await app.handle(new Request('http://localhost/'))
		expect({ own, enumerable }).toEqual({ own: true, enumerable: true })
	})

	it('masks unhandled generic error messages', async () => {
		const app = new Elysia().get('/', () => {
			throw new Error('SECRET: database password leaked from driver')
		})

		const response = await app.handle(new Request('http://localhost/'))
		const text = await response.text()

		expect(text).not.toContain('SECRET')
		expect(JSON.parse(text)).toEqual({
			type: 'internal-server-error',
			code: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500
		})
		expect(response.status).toBe(500)
		expect(response.headers.get('content-type')).toBe(
			'application/problem+json'
		)
	})

	it('masks returned Error messages', async () => {
		const app = new Elysia().get('/', () => {
			const error = new Error('SECRET: upstream token') as Error & {
				cause: string
			}
			error.cause = 'SECRET: nested postgres detail'

			return error
		})

		const response = await app.handle(new Request('http://localhost/'))
		const text = await response.text()

		expect(text).not.toContain('SECRET')
		expect(JSON.parse(text)).toEqual({
			type: 'internal-server-error',
			code: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500
		})
		expect(response.status).toBe(500)
	})

	it('masks direct Error response payloads and omits cause', async () => {
		const error = new Error('SECRET: upstream token') as Error & {
			cause: string
		}
		error.cause = 'SECRET: nested postgres detail'

		const response = mapCompactResponse(error)

		await expect(response.json()).resolves.toEqual({
			type: 'internal-server-error',
			code: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500
		})
		expect(response.status).toBe(500)
	})
})
