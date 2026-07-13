import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { createAdapter } from '../../src/adapter'
import { materializeSetHeaders } from '../../src/adapter/utils'
import { WebStandardAdapter } from '../../src/adapter/web-standard'
import { routeDescriptors } from '../../src/compile/handler/descriptor'
import { createContext } from '../../src/context'
import { ElysiaStatus } from '../../src/error'
import { req } from '../utils'

describe('C1 default-header sink', () => {
	it('recognizes defaults marked by another Elysia copy', () => {
		const headers = Object.assign(Object.create(null), {
			'x-default': 'base'
		})
		Object.defineProperty(headers, '\0', {
			value: headers
		})
		Object.freeze(headers)

		const set = { headers } as any
		expect(materializeSetHeaders(set)).not.toBe(headers)
		expect(set.headers['x-default']).toBe('base')
	})

	it('shares one immutable record until a route can expose set', () => {
		const app = new Elysia().headers({ 'x-default': 'base' })
		const Context = createContext(app)
		const first = new Context(req('/'))
		const second = new Context(req('/'))

		expect(first.set.headers).toBe(second.set.headers)
		expect(Object.isFrozen(first.set.headers)).toBeTrue()
	})

	it('copies before user mutation and never leaks across requests', async () => {
		let request = 0
		const seen: object[] = []
		const app = new Elysia()
			.headers({ 'x-default': 'base', 'x-remove': 'keep' })
			.get('/', ({ set }) => {
				seen.push(set.headers)
				if (request++ === 0) {
					set.headers['x-default'] = 'first'
					set.headers['x-only-first'] = 'yes'
					delete set.headers['x-remove']
				}

				return 'ok'
			})

		const first = await app.handle(req('/'))
		expect(first.headers.get('x-default')).toBe('first')
		expect(first.headers.get('x-only-first')).toBe('yes')
		expect(first.headers.get('x-remove')).toBeNull()

		const second = await app.handle(req('/'))
		expect(second.headers.get('x-default')).toBe('base')
		expect(second.headers.get('x-only-first')).toBeNull()
		expect(second.headers.get('x-remove')).toBe('keep')

		expect(seen[0]).not.toBe(seen[1])
		expect(seen.every((headers) => !Object.isFrozen(headers))).toBeTrue()
	})

	it('preserves consumed and reused Response bodies', async () => {
		const shared = new Response('payload', {
			headers: { 'x-response': 'yes' }
		})
		const app = new Elysia()
			.headers({ 'x-default': 'base' })
			.get('/', () => shared)

		for (let i = 0; i < 2; i++) {
			const response = await app.handle(req('/'))
			expect(response.headers.get('x-default')).toBe('base')
			expect(response.headers.get('x-response')).toBe('yes')
			await expect(response.text()).resolves.toBe('payload')
		}

		expect(shared.bodyUsed).toBeFalse()
		expect(shared.headers.get('x-default')).toBeNull()
	})

	it('materializes only when a stream patches response headers', async () => {
		const app = new Elysia()
			.headers({ 'x-default': 'base' })
			.get('/', function* () {
				yield 'a'
				yield 'b'
			})

		const response = await app.handle(req('/'))
		expect(response.headers.get('x-default')).toBe('base')
		expect(response.headers.get('transfer-encoding')).toBe('chunked')
		await expect(response.text()).resolves.toBe('ab')
	})

	it('keeps request-hook mutations request-local', async () => {
		let request = 0
		const app = new Elysia()
			.headers({ 'x-default': 'base' })
			.request(({ set }) => {
				if (request++ === 0) set.headers['x-first'] = 'yes'
			})
			.get('/', () => 'ok')

		expect((await app.handle(req('/'))).headers.get('x-first')).toBe('yes')
		expect((await app.handle(req('/'))).headers.get('x-first')).toBeNull()
	})

	it('copies once when a request hook and route handler both expose set', async () => {
		const seen: object[] = []
		const app = new Elysia()
			.headers({ 'x-default': 'base' })
			.request(({ set }) => {
				seen.push(set.headers)
			})
			.get('/', ({ set }) => {
				seen.push(set.headers)
				set.headers['x-route'] = 'yes'
				return 'ok'
			})

		const response = await app.handle(req('/'))
		expect(response.headers.get('x-route')).toBe('yes')
		expect(seen[0]).toBe(seen[1])
	})

	it('keeps the conservative whole-context inference floor', async () => {
		const opaque = (context: any) => {
			context.set.headers['x-opaque'] = 'yes'
			return 'ok'
		}
		const app = new Elysia()
			.headers({ 'x-default': 'base' })
			.get('/', (context) => opaque(context))

		const response = await app.handle(req('/'))
		expect(response.status).toBe(200)
		expect(response.headers.get('x-opaque')).toBe('yes')
		expect(routeDescriptors.get(app as any)?.get('GET /')?.responseMode).toBe(
			'set-with-default-headers'
		)
	})

	it('materializes defaults for internal error, status, 404, and cookie patches', async () => {
		const errorApp = new Elysia()
			.headers({ 'x-default': 'base' })
			.error(({ set }) => {
				set.headers['x-error'] = 'yes'
				return 'caught'
			})
			.get('/', () => {
				throw new Error('boom')
			})
		const errorResponse = await errorApp.handle(req('/'))
		expect(errorResponse.headers.get('x-error')).toBe('yes')

		const statusApp = new Elysia()
			.headers({ 'x-default': 'base' })
			.get(
				'/',
				() => new ElysiaStatus(201, 'ok', { 'x-status': 'yes' })
			)
		const statusResponse = await statusApp.handle(req('/'))
		expect(statusResponse.status).toBe(201)
		expect(statusResponse.headers.get('x-status')).toBe('yes')

		const notFoundApp = new Elysia().headers({ 'x-default': 'base' })
		const notFoundResponse = await notFoundApp.handle(req('/missing'))
		expect(notFoundResponse.status).toBe(404)
		expect(notFoundResponse.headers.get('content-type')).toBe(
			'application/problem+json'
		)

		const cookieApp = new Elysia()
			.headers({ 'x-default': 'base' })
			.get('/', ({ cookie }) => {
				cookie.session.value = 'yes'
				return 'ok'
			})
		const cookieResponse = await cookieApp.handle(req('/'))
		expect(cookieResponse.headers.getSetCookie()).toEqual([
			'session=yes; Path=/'
		])
	})

	it('falls back when an adapter does not support the sink', async () => {
		const headers: object[] = []
		const adapter = createAdapter({
			...WebStandardAdapter,
			response: {
				...WebStandardAdapter.response,
				supportsDefaultHeaderSink: undefined,
				map(response: unknown, set: any, request?: Request) {
					headers.push(set.headers)
					set.headers['x-adapter'] = 'yes'
					return WebStandardAdapter.response.map(
						response,
						set,
						request
					)
				}
			}
		})
		const app = new Elysia({ adapter })
			.headers({ 'x-default': 'base' })
			.get('/', () => 'ok')

		for (let i = 0; i < 2; i++) {
			const response = await app.handle(req('/'))
			expect(response.headers.get('x-default')).toBe('base')
			expect(response.headers.get('x-adapter')).toBe('yes')
		}

		expect(headers[0]).not.toBe(headers[1])
		expect(headers.every((value) => !Object.isFrozen(value))).toBeTrue()
	})

	it('records the selected response mode once in the descriptor', async () => {
		const app = new Elysia()
			.headers({ 'x-default': 'base' })
			.get('/default', () => 'ok')
			.get('/set', ({ set }) => {
				set.status = 201
				return 'ok'
			})

		await app.handle(req('/default'))
		await app.handle(req('/set'))

		const descriptors = routeDescriptors.get(app as any)!
		expect(descriptors.get('GET /default')?.responseMode).toBe(
			'default-headers'
		)
		expect(descriptors.get('GET /set')?.responseMode).toBe(
			'set-with-default-headers'
		)
	})

	it('keeps an empty default-header declaration compact', async () => {
		const app = new Elysia().headers({}).get('/', () => 'ok')
		await app.handle(req('/'))
		expect(routeDescriptors.get(app as any)?.get('GET /')?.responseMode).toBe(
			'compact'
		)
	})
})
