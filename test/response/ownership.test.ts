import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

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

	it('serves a borrowed shared Response with identical bytes twice', async () => {
		const shared = borrow(new Response('same-bytes'))
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-marker'] = 'yes'
			return shared
		})

		const first = await app.handle(req('/'))
		const second = await app.handle(req('/'))

		const firstBytes = new Uint8Array(await first.arrayBuffer())
		const secondBytes = new Uint8Array(await second.arrayBuffer())

		expect(firstBytes).toEqual(secondBytes)
		expect(new TextDecoder().decode(firstBytes)).toBe('same-bytes')
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

	it('owns a fresh mounted Response and patches it by reference', async () => {
		const app = new Elysia()
			.headers({ 'x-outer': 'yes' })
			.mount('/mount', () => new Response('mounted'))

		for (let i = 0; i < 3; i++) {
			const response = await app.handle(req('/mount'))
			expect(response.headers.get('x-outer')).toBe('yes')
			await expect(response.text()).resolves.toBe('mounted')
		}
	})

	it('treats a reused unmarked mounted Response as single-use', async () => {
		const shared = new Response('mounted')
		const app = new Elysia()
			.headers({ 'x-outer': 'yes' })
			.mount('/mount', () => shared)

		const first = await app.handle(req('/mount'))
		expect(first.headers.get('x-outer')).toBe('yes')
		await expect(first.text()).resolves.toBe('mounted')

		const second = await app.handle(req('/mount'))
		expect(second.status).toBe(500)
	})

	it('keeps a borrowed mounted Response reusable', async () => {
		const shared = borrow(new Response('mounted'))
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

	it('routes a locked owned Response that needs patching through error hooks', async () => {
		let reader!: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>
		const app = new Elysia()
			.error(({ set }) => {
				set.status = 409
				return 'caught'
			})
			.get('/', ({ set }) => {
				set.headers['x-patch'] = 'yes'
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

	it('merges default headers into an owned Response', async () => {
		const app = new Elysia()
			.headers({ 'x-powered-by': 'Elysia' })
			.get('/', () => new Response('ok'))

		const response = await app.handle(req('/'))
		expect(response.headers.get('x-powered-by')).toBe('Elysia')
		await expect(response.text()).resolves.toBe('ok')
	})

	it('preserves an explicit content-length through the owned merge', async () => {
		let original!: Response
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-powered-by'] = 'Elysia'

			return (original = new Response('Hi', {
				headers: { 'content-length': '2' }
			}))
		})

		const response = await app.handle(req('/'))

		expect(response).not.toBe(original)
		expect(response.headers.get('x-powered-by')).toBe('Elysia')
		expect(response.headers.get('content-length')).toBe('2')
		await expect(response.text()).resolves.toBe('Hi')

		expect(original.headers.get('x-powered-by')).toBeNull()
	})

	it('applies cookie writes to an owned Response', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.session.value = 'abc'
			return new Response('with-cookie')
		})

		const response = await app.handle(req('/'))
		expect(response.headers.getSetCookie()).toEqual([
			'session=abc; Path=/'
		])
		await expect(response.text()).resolves.toBe('with-cookie')
	})

	it('passes an owned Response through by reference when set is untouched', async () => {
		let original!: Response
		const app = new Elysia().get(
			'/',
			() => (original = new Response('untouched'))
		)

		const response = await app.handle(req('/'))
		expect(response).toBe(original)
		await expect(response.text()).resolves.toBe('untouched')
	})

	it('does not bleed per-request headers across sequential owned requests', async () => {
		let counter = 0
		const app = new Elysia()
			.headers({ 'x-default': 'yes' })
			.get('/', ({ set }) => {
				counter++
				set.headers['x-request-id'] = String(counter)
				if (counter === 1) set.headers['x-only-first'] = 'yes'

				return new Response('fresh')
			})

		const first = await app.handle(req('/'))
		expect(first.headers.get('x-default')).toBe('yes')
		expect(first.headers.get('x-request-id')).toBe('1')
		expect(first.headers.get('x-only-first')).toBe('yes')
		await expect(first.text()).resolves.toBe('fresh')

		const second = await app.handle(req('/'))
		expect(second.headers.get('x-default')).toBe('yes')
		expect(second.headers.get('x-request-id')).toBe('2')
		expect(second.headers.get('x-only-first')).toBeNull()
		await expect(second.text()).resolves.toBe('fresh')
	})

	// Documented contract boundary: a locked-but-unread owned body is only
	// detected when set state must be patched in. On the untouched-set path
	// the response passes through as-is — probing `.body` there would
	// materialize lazy bodies and degrade native serving for every
	// well-behaved response (see CHANGELOG owned-Response entry)
	it('passes a locked unread owned body through untouched when no set state applies', async () => {
		const app = new Elysia().get('/', () => {
			const response = new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('x'))
						controller.close()
					}
				})
			)
			response.body!.getReader()
			return response
		})

		const response = await app.handle(req('/'))
		expect(response.status).toBe(200)
		expect(response.body?.locked).toBe(true)
	})

	it('throws loudly on a locked unread owned body when set state must be patched', async () => {
		const app = new Elysia()
			.headers({ 'x-default': 'yes' })
			.get('/', () => {
				const response = new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('x'))
							controller.close()
						}
					})
				)
				response.body!.getReader()
				return response
			})

		const response = await app.handle(req('/'))
		expect(response.status).toBe(500)
	})

	// borrow's retention contract is "body bytes stay resident" — a borrowed
	// stream retains its whole body and chains a tee per reuse, so serving
	// one must warn (once), while buffered borrows must stay silent
	describe('borrow stream guard', () => {
		const originalWarn = console.warn
		let warnings: unknown[][]

		beforeEach(() => {
			warnings = []
			console.warn = (...args: unknown[]) => {
				warnings.push(args)
			}
		})

		afterEach(() => {
			console.warn = originalWarn
		})

		const streamed = () =>
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('streamed'))
					controller.close()
				}
			})

		it('warns once for a borrowed streaming response', async () => {
			const shared = borrow(new Response(streamed()))
			const app = new Elysia().get('/', ({ set }) => {
				set.headers['x-marker'] = 'yes'
				return shared
			})

			await app.handle(req('/'))
			await app.handle(req('/'))

			const borrowWarnings = warnings.filter((args) =>
				String(args[0]).includes('borrow()')
			)
			expect(borrowWarnings).toHaveLength(1)
		})

		it('does not warn for a borrowed buffered response', async () => {
			const shared = borrow(new Response('hello'))
			const app = new Elysia().get('/', ({ set }) => {
				set.headers['x-marker'] = 'yes'
				return shared
			})

			const first = await app.handle(req('/'))
			const second = await app.handle(req('/'))

			expect(warnings).toHaveLength(0)
			await expect(first.text()).resolves.toBe('hello')
			await expect(second.text()).resolves.toBe('hello')
		})

		it('still serves the first read of a borrowed streaming response', async () => {
			const shared = borrow(new Response(streamed()))
			const app = new Elysia().get('/', ({ set }) => {
				set.headers['x-marker'] = 'yes'
				return shared
			})

			const first = await app.handle(req('/'))
			await expect(first.text()).resolves.toBe('streamed')
		})
	})
})
