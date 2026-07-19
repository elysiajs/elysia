import { describe, expect, it } from 'bun:test'

import { borrow, Elysia } from '../../src'
import { req } from '../utils'

describe('Response ownership', () => {
	it('transfers an owned handler body without cloning', async () => {
		let original!: Response
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-framework'] = 'yes'
			original = new Response('owned')
			;(original as any).clone = () => {
				throw new Error('owned responses must not clone')
			}

			return original
		})

		const response = await app.handle(req('/'))

		expect(response).not.toBe(original)
		expect(response.headers.get('x-framework')).toBe('yes')
		await expect(response.text()).resolves.toBe('owned')
		expect(original.bodyUsed).toBeTrue()
	})

	it('does not re-pump an owned chunked body through JavaScript', async () => {
		let originalBody!: ReadableStream
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-framework'] = 'yes'
			const response = new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('chunk'))
						controller.close()
					}
				}),
				{ headers: { 'transfer-encoding': 'chunked' } }
			)
			originalBody = response.body!
			return response
		})

		const response = await app.handle(req('/'))

		expect(response.body).toBe(originalBody)
		await expect(response.text()).resolves.toBe('chunk')
	})

	it('preserves Response metadata precedence on the owned path', async () => {
		const app = new Elysia().get('/', ({ cookie, set }) => {
			set.status = 202
			set.headers['x-source'] = 'framework'
			cookie.framework.value = '1'

			return new Response('owned', {
				status: 201,
				headers: {
					'x-source': 'response',
					'set-cookie': 'origin=1'
				}
			})
		})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(201)
		expect(response.headers.get('x-source')).toBe('response')
		expect(response.headers.getSetCookie()).toEqual([
			'origin=1',
			'framework=1; Path=/'
		])
	})

	it('keeps an explicitly borrowed Response reusable', async () => {
		const shared = borrow(
			new Response('shared', { headers: { 'x-source': 'response' } })
		)
		let request = 0
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-request'] = String(++request)
			return shared
		})

		for (let i = 1; i <= 3; i++) {
			const response = await app.handle(req('/'))
			expect(response.headers.get('x-request')).toBe(String(i))
			expect(response.headers.get('x-source')).toBe('response')
			await expect(response.text()).resolves.toBe('shared')
		}

		await expect(shared.clone().text()).resolves.toBe('shared')
		expect(shared.headers.get('x-request')).toBeNull()
	})

	it('clones a direct static Response for each request', async () => {
		const staticResponse = new Response('static')
		const app = new Elysia().get(
			'/',
			{
				beforeHandle({ set }) {
					set.headers['x-static'] = 'yes'
				}
			},
			staticResponse
		)

		for (let i = 0; i < 3; i++) {
			const response = await app.handle(req('/'))
			expect(response.headers.get('x-static')).toBe('yes')
			await expect(response.text()).resolves.toBe('static')
		}

		expect(staticResponse.bodyUsed).toBeFalse()
	})

	it('treats mounted Responses as borrowed foreign results', async () => {
		const shared = new Response('mounted')
		const app = new Elysia()
			.headers({ 'x-outer': 'yes' })
			.mount('/mount', () => shared)

		for (let i = 0; i < 3; i++) {
			const response = await app.handle(req('/mount'))
			expect(response.headers.get('x-outer')).toBe('yes')
			await expect(response.text()).resolves.toBe('mounted')
		}

		await expect(shared.clone().text()).resolves.toBe('mounted')
	})

	it('owns Responses returned by mapResponse hooks', async () => {
		let mapped!: Response
		const app = new Elysia().get(
			'/',
			{
				mapResponse({ set }) {
					set.headers['x-hook'] = 'yes'
					mapped = new Response('hook')
					;(mapped as any).clone = () => {
						throw new Error('hook responses must not clone')
					}

					return mapped
				}
			},
			() => 'handler'
		)

		const response = await app.handle(req('/'))
		expect(response.headers.get('x-hook')).toBe('yes')
		await expect(response.text()).resolves.toBe('hook')
		expect(mapped.bodyUsed).toBeTrue()
	})

	it('routes a consumed owned Response through error hooks', async () => {
		const app = new Elysia()
			.error(({ set }) => {
				set.status = 409
				return 'caught'
			})
			.get('/', async () => {
				const response = new Response('consumed')
				await response.text()
				return response
			})

		const response = await app.handle(req('/'))
		expect(response.status).toBe(409)
		await expect(response.text()).resolves.toBe('caught')
	})

	it('routes a reused owned Response through the default error path', async () => {
		const shared = new Response('shared')
		const app = new Elysia().get('/', () => shared)

		await expect((await app.handle(req('/'))).text()).resolves.toBe(
			'shared'
		)

		const response = await app.handle(req('/'))
		expect(response.status).toBe(500)
	})

	it('routes a locked owned Response through error hooks', async () => {
		let reader!: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>
		const app = new Elysia()
			.error(({ set }) => {
				set.status = 409
				return 'caught'
			})
			.get('/', () => {
				const response = new Response('locked')
				reader = response.body!.getReader()
				return response
			})

		try {
			const response = await app.handle(req('/'))
			expect(response.status).toBe(409)
			await expect(response.text()).resolves.toBe('caught')
		} finally {
			await reader.cancel()
			reader.releaseLock()
		}
	})

	it('keeps a borrowed Response reusable after bounded cancellation', async () => {
		let cancelled = false
		const shared = borrow(
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('first'))
						controller.enqueue(new TextEncoder().encode('second'))
						controller.close()
					},
					cancel() {
						cancelled = true
					}
				})
			)
		)
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-patch'] = 'yes'
			return shared
		})

		const first = await app.handle(req('/'))
		const reader = first.body!.getReader()
		await reader.read()
		await reader.cancel('stop')

		const second = await app.handle(req('/'))

		expect(cancelled).toBeFalse()
		await expect(second.text()).resolves.toBe('firstsecond')
	})
})
