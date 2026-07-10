import { Elysia, t } from '../../src'
import { mapCompactResponse } from '../../src/adapter/web-standard/handler'
import { computeIsProduction } from '../../src/universal/is-production'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

describe('isProduction fail-safe', () => {
	// Security regression: on runtimes with no readable environment (Cloudflare
	// Workers without nodejs_compat — no `process`, no `Bun.env`), we cannot tell
	// dev from prod, so we MUST assume production and redact. Otherwise error
	// messages/cause and validation `found`/`expected` leak by default. This is
	// the exact branch that runs on Workers; it is not exercisable in-process on
	// Bun (where env is always readable), so it is tested through the pure helper.
	it('assumes production when the environment is unreadable', () => {
		expect(computeIsProduction(false, undefined, undefined)).toBe(true)
		// even a stray value cannot make an unreadable env "development"
		expect(computeIsProduction(false, 'development', undefined)).toBe(true)
	})

	it('honors NODE_ENV / ENV when the environment is readable', () => {
		expect(computeIsProduction(true, undefined, undefined)).toBe(false)
		expect(computeIsProduction(true, 'development', undefined)).toBe(false)
		expect(computeIsProduction(true, 'production', undefined)).toBe(true)
		expect(computeIsProduction(true, undefined, 'production')).toBe(true)
	})
})

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

	// An unhandled error becomes an RFC 9457 problem+json 500. In production the
	// body collapses to `{type,title,status}` — `detail`/`name`/`cause` are
	// dropped so a thrown secret can never reach the client.
	it('masks unhandled generic error messages', async () => {
		const app = new Elysia().get('/', () => {
			throw new Error('SECRET: database password leaked from driver')
		})

		const response = await app.handle(new Request('http://localhost/'))
		const text = await response.text()

		expect(text).not.toContain('SECRET')
		expect(JSON.parse(text)).toEqual({
			type: 'internal-server-error',
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
			title: 'Internal Server Error',
			status: 500
		})
		expect(response.status).toBe(500)
	})
})
