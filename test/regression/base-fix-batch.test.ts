import { Elysia } from '../../src'
import { autoHead } from '../../src/plugin/auto-head'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('async setup readiness and awaited cleanup', () => {
	it('await app.stop() does not resolve until every cleanup handler settles, in order', async () => {
		const order: string[] = []

		const app = new Elysia()
			.cleanup(async () => {
				await new Promise((r) => setTimeout(r, 20))
				order.push('first')
			})
			.cleanup(async () => {
				await new Promise((r) => setTimeout(r, 5))
				order.push('second')
			})

		// Simulate a running server so stop() has something to stop.
		let stopped = false
		;(app as any).server = {
			stop() {
				stopped = true
			}
		}

		await app.stop()

		// Both cleanups finished before the awaited stop() resolved, and they
		// ran sequentially in registration order (not by their timer delays).
		expect(stopped).toBe(true)
		expect(order).toEqual(['first', 'second'])
	})

	it('stop() awaits an async server.stop() before running cleanup', async () => {
		const order: string[] = []

		const app = new Elysia().cleanup(() => {
			order.push('cleanup')
		})

		;(app as any).server = {
			async stop() {
				await new Promise((r) => setTimeout(r, 10))
				order.push('server-stopped')
			}
		}

		await app.stop()

		expect(order).toEqual(['server-stopped', 'cleanup'])
	})
})

describe('auto-HEAD never buffers an unknown-length body', () => {
	it('cancels the stream and omits content-length instead of reading it', async () => {
		let pulled = 0

		// A stream that FAILS the test if it is ever fully drained: if auto-HEAD
		// buffered the body to compute content-length, `pulled` would advance
		// past the first chunk. The correct behaviour cancels the stream.
		const makeStream = () =>
			new ReadableStream({
				pull(controller) {
					pulled++
					if (pulled > 1)
						controller.error(
							new Error(
								'auto-HEAD buffered the body — it must not read the stream'
							)
						)
					else controller.enqueue(new Uint8Array([1, 2, 3]))
				}
			})

		const app = new Elysia().use(autoHead()).get(
			'/stream',
			() =>
				new Response(makeStream(), {
					headers: { 'content-type': 'application/octet-stream' }
				})
		)
		await app.modules

		// warm the GET wrapper first (separate stream instance)
		await app.handle(req('/stream'))

		const head = await app.handle(req('/stream', { method: 'HEAD' }))

		expect(head.status).toBe(200)
		expect(await head.text()).toBe('')
		// no synthesized content-length for an unknown-length body
		expect(head.headers.get('content-length')).toBeNull()
	})

	it('preserves an already-known content-length without reading the body', async () => {
		const app = new Elysia().use(autoHead()).get(
			'/known',
			() =>
				new Response('hello world', {
					headers: { 'content-length': '11' }
				})
		)
		await app.modules

		await app.handle(req('/known'))

		const head = await app.handle(req('/known', { method: 'HEAD' }))
		expect(head.status).toBe(200)
		expect(head.headers.get('content-length')).toBe('11')
		expect(await head.text()).toBe('')
	})
})

describe('cross-kind override replaces instead of silently no-oping', () => {
	it('decorate override replaces a primitive with an object', () => {
		const app = new Elysia()
			.decorate('config', 'legacy')
			.decorate('override', 'config', { mode: 'prod' } as any)

		expect((app as any)['~ext'].decorator.config).toEqual({ mode: 'prod' })
	})

	it('state override replaces a primitive with an object', () => {
		const app = new Elysia()
			.state('config', 1)
			.state('override', 'config', { mode: 'prod' } as any)

		expect((app as any)['~ext'].store.config).toEqual({ mode: 'prod' })
	})

	it('two plain objects still merge under override', () => {
		const app = new Elysia()
			.decorate('config', { a: 1, b: 2 } as any)
			.decorate('override', 'config', { b: 3, c: 4 } as any)

		expect((app as any)['~ext'].decorator.config).toEqual({
			a: 1,
			b: 3,
			c: 4
		})
	})
})

describe('late-add throws after seal', () => {
	// Original intent: a `.get()` after the first request (once the fetch handler
	// was materialized) produced a dev-only warning and silently rebuilt. Under
	// the first request SEALS the app, so late authoring is retired in favour of a
	// synchronous throw — the warning is superseded by the immutability contract.

	it('.get() after the first request throws instead of silently rebuilding', async () => {
		const app = new Elysia().get('/first', () => 'first')
		await app.handle(req('/first')) // seals the app

		// Retired behavior: warn + silent invalidate + recover on next compile().
		//  behavior: the sealed instance is immutable and the mutation throws.
		expect(() => app.get('/late', () => 'late')).toThrow(
			'after the app was sealed'
		)

		// The seal is intact: the routes registered before sealing still serve.
		const res = await app.handle(req('/first'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('first')
	})

	it('authoring-then-serve (normal flow) neither throws nor warns', async () => {
		const calls: string[] = []
		const orig = console.warn
		console.warn = (...args: any[]) => {
			if (typeof args[0] === 'string' && args[0].includes('materialized'))
				calls.push(args[0])
			else orig.apply(console, args)
		}

		try {
			// An async plugin that adds a route while still authorable (#pending > 0,
			// pre-seal). Registering all routes BEFORE the first request is the
			// sanctioned flow: it must not throw and must not warn.
			let resolvePlugin!: (app: any) => void
			const blocked = new Promise<void>((res) => {
				resolvePlugin = res as any
			})

			const asyncPlugin = async (app: any) => {
				await blocked
				return app.get('/async-added', () => 'ok')
			}

			const app = new Elysia()
				.get('/first', () => 'first')
				.use(asyncPlugin)

			// Resolve the plugin and drain BEFORE the first request — the app is
			// still authorable, so the route registers without tripping the seal.
			resolvePlugin(undefined)
			await app.modules

			// Both routes serve; the drain did not seal, so this is the happy path.
			expect((await app.handle(req('/first'))).status).toBe(200)
			expect((await app.handle(req('/async-added'))).status).toBe(200)
		} finally {
			console.warn = orig
		}

		// No late-add warning should have been emitted on the normal flow.
		expect(calls.length).toBe(0)
	})

	it('late-add throws in production too (NODE_ENV=production)', async () => {
		const prev = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'

		try {
			// The seal contract is not dev-only: a post-seal mutation throws in
			// production as well (the retired warning was dev-only; the throw is not).
			const app = new Elysia().get('/first', () => 'first')
			await app.handle(req('/first')) // seals

			expect(() => app.get('/late', () => 'late')).toThrow(
				'after the app was sealed'
			)
		} finally {
			process.env.NODE_ENV = prev
		}
	})
})

describe('custom method tokens are normalized to uppercase', () => {
	it('.method with a lowercase token matches an uppercase Request.method', async () => {
		const app = new Elysia().method('purge', '/cache', () => 'purged')

		const res = await app.handle(
			new Request('http://localhost/cache', { method: 'PURGE' })
		)

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('purged')
	})
})
