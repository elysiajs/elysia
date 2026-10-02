import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen } from '../ws/utils'

describe('Stop', () => {
	const withServeCount = async (run: () => void | Promise<void>) => {
		const realServe = Bun.serve.bind(Bun)
		let calls = 0
		const created: any[] = []
		;(Bun as any).serve = (opts: any) => {
			calls++
			const s = realServe(opts)
			created.push(s)
			return s
		}

		try {
			await run()
			await new Promise((r) => setTimeout(r, 50))

			let liveOrphans = 0
			for (const s of created) {
				try {
					const res = await fetch(
						'http://localhost:' + s.port + '/',
						{ signal: AbortSignal.timeout(150) }
					)
					await res.text().catch(() => {})
					liveOrphans++
				} catch {}
			}

			return { calls, liveOrphans, created }
		} finally {
			for (const s of created) {
				try {
					s.stop?.(true)
				} catch {}
			}
			;(Bun as any).serve = realServe
		}
	}

	it('stops immediately after listen without creating an orphan server', async () => {
		const result = await withServeCount(() => {
			const app = new Elysia().get('/', () => 'hi')
			app.listen(0)
			app.stop()
			expect(app.server).toBeUndefined()
		})

		expect(result!.calls).toBe(1)
		expect(result!.liveOrphans).toBe(0)
	})

	it('stops an async-plugin app immediately without creating an orphan server', async () => {
		const result = await withServeCount(() => {
			const app = new Elysia()
				.use(Promise.resolve(new Elysia().get('/p', () => 'p')))
				.get('/', () => 'hi')
			app.listen(0)
			app.stop()
			expect(app.server).toBeUndefined()
		})

		expect(result!.calls).toBe(1)
		expect(result!.liveOrphans).toBe(0)
	})

	it('stops while async modules resolve without throwing or leaving a server', async () => {
		let threw: unknown
		const result = await withServeCount(async () => {
			let resolveSlow!: (plugin: any) => void
			const slow = new Promise<any>((resolve) => {
				resolveSlow = resolve
			})
			const app = new Elysia().use(slow as any).get('/', () => 'hi')
			app.listen(0)

			try {
				// stop while the async module is still unresolved
				app.stop()
				resolveSlow(new Elysia().get('/p', () => 'p'))
				await app.modules
			} catch (e) {
				threw = e
			}

			expect(app.server).toBeUndefined()
		})

		expect(threw).toBeUndefined()
		expect(result!.calls).toBe(1)
		expect(result!.liveOrphans).toBe(0)
	})

	it('withholds configured native routes until async setup publishes', async () => {
		let finish!: () => void
		const setupReady = new Promise<void>((resolve) => (finish = resolve))
		const app = new Elysia({
			serve: { routes: { '/native': new Response('native') } }
		} as any)
			.setup(() => setupReady)
			.listen(0)
		const port = app.server!.port

		try {
			let settled = false
			const early = fetch(`http://localhost:${port}/native`, {
				signal: AbortSignal.timeout(1000)
			}).then((response) => {
				settled = true
				return response
			})

			await Bun.sleep(20)
			expect(settled).toBe(false)

			finish()
			await early
			await expect(
				fetch(`http://localhost:${port}/native`).then((x) => x.text())
			).resolves.toBe('native')
		} finally {
			finish()
			await app.stop(true)?.catch(() => {})
		}
	})

	it('shuts down the server when stop(true) is called', async () => {
		const app = new Elysia()
		app.get('/health', 'hi')

		const server = app.listen(0)
		const port = server.server!.port

		await fetch(`http://localhost:${port}/health`)

		await server.stop(true)

		// The server must no longer accept connections
		await expect(fetch(`http://localhost:${port}/health`)).rejects.toThrow()
	})

	it('treats stop(false) as the same graceful stop as stop()', async () => {
		let resource = 'open'
		let cleanups = 0
		const app = new Elysia()
			.get('/health', () => resource)
			.cleanup(() => {
				resource = 'closed'
				cleanups++
			})

		const server = app.listen(0)
		// stop() clears `app.server`, so keep a handle for teardown
		const bunServer = server.server!
		const port = bunServer.port

		try {
			await expect(
				fetch(`http://localhost:${port}/health`).then((x) => x.text())
			).resolves.toBe('open')

			// `false` is not a serving mode of its own: it runs the same
			// drain, the same cleanup and the same release as an omitted
			// argument, so the listener is gone and the epoch is free
			await server.stop(false)
			expect(cleanups).toBe(1)
			expect(resource).toBe('closed')
			expect(app.server).toBeUndefined()
			await expect(
				fetch(`http://localhost:${port}/health`, {
					signal: AbortSignal.timeout(500)
				})
			).rejects.toThrow()

			expect(() => app.listen(0)).not.toThrow()
			expect(app.server).not.toBe(bunServer)
			await Bun.sleep(0)

			// A released epoch acquires and releases its own resources again
			await app.stop(false)
			expect(cleanups).toBe(2)
		} finally {
			await app.stop(true)?.catch(() => {})
			await bunServer.stop(true)
		}
	})

	it('gates new requests and drains active HTTP before default cleanup', async () => {
		let started!: () => void
		let finish!: () => void
		let closeStarted!: () => void
		let finishClose!: () => void
		const active = new Promise<void>((resolve) => (started = resolve))
		const release = new Promise<void>((resolve) => (finish = resolve))
		const activeClose = new Promise<void>(
			(resolve) => (closeStarted = resolve)
		)
		const closeReady = new Promise<void>(
			(resolve) => (finishClose = resolve)
		)
		const order: string[] = []
		let cleanups = 0
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				close: async () => {
					order.push('close-start')
					closeStarted()
					await closeReady
					order.push('close-end')
				}
			})
			.get('/native', 'native')
			.get('/slow', async () => {
				started()
				await release
				return 'done'
			})
			.cleanup(() => {
				order.push('cleanup')
				cleanups++
			})
			.listen(0)
		const port = app.server!.port
		const ws = newWebsocket(app.server!)

		try {
			await wsOpen(ws)
			await expect(
				fetch(`http://localhost:${port}/native`).then((x) => x.text())
			).resolves.toBe('native')
			const request = fetch(`http://localhost:${port}/slow`)
			await active

			const stopping = app.stop()
			await activeClose
			expect(cleanups).toBe(0)
			const gated = await fetch(`http://localhost:${port}/native`)
			expect(gated.status).toBe(503)

			finishClose()
			finish()
			await expect(request.then((x) => x.text())).resolves.toBe('done')
			await stopping
			expect(cleanups).toBe(1)
			expect(order).toEqual(['close-start', 'close-end', 'cleanup'])
			await expect(
				fetch(`http://localhost:${port}/native`, {
					signal: AbortSignal.timeout(500)
				})
			).rejects.toThrow()
		} finally {
			finish()
			finishClose()
			ws.close()
			await app.stop(true)?.catch(() => {})
		}
	})

	it('drains HTTP and WebSocket work under explicit false', async () => {
		let httpStarted!: () => void
		let finishHTTP!: () => void
		let messageStarted!: () => void
		let finishMessage!: () => void
		let closeStarted!: () => void
		let finishClose!: () => void
		const activeHTTP = new Promise<void>(
			(resolve) => (httpStarted = resolve)
		)
		const httpReady = new Promise<void>((resolve) => (finishHTTP = resolve))
		const activeMessage = new Promise<void>(
			(resolve) => (messageStarted = resolve)
		)
		const messageReady = new Promise<void>(
			(resolve) => (finishMessage = resolve)
		)
		const activeClose = new Promise<void>(
			(resolve) => (closeStarted = resolve)
		)
		const closeReady = new Promise<void>(
			(resolve) => (finishClose = resolve)
		)
		const order: string[] = []
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message: async () => {
					order.push('message-start')
					messageStarted()
					await messageReady
					order.push('message-end')
				},
				close: async () => {
					order.push('close-start')
					closeStarted()
					await closeReady
					order.push('close-end')
				}
			})
			.get('/slow', async () => {
				order.push('http-start')
				httpStarted()
				await httpReady
				order.push('http-end')
				return 'done'
			})
			.cleanup(() => order.push('cleanup'))
			.listen(0)
		const server = app.server!
		const port = server.port
		const ws = newWebsocket(server)

		try {
			await wsOpen(ws)
			ws.send('hold')
			await activeMessage
			const request = fetch(`http://localhost:${port}/slow`)
			await activeHTTP

			const stopping = app.stop(false)!
			await Bun.sleep(0)
			expect(order).not.toContain('cleanup')

			// The adapter terminates the tracked socket itself, then drains
			// the request that is still in flight; cleanup runs after both
			await activeClose
			finishHTTP()
			await expect(request.then((x) => x.text())).resolves.toBe('done')
			finishClose()
			finishMessage()
			await stopping

			expect(order.at(-1)).toBe('cleanup')
			expect(order).toContain('message-end')
			expect(order).toContain('close-end')
		} finally {
			finishHTTP()
			finishMessage()
			finishClose()
			ws.close()
			await app.stop(true)?.catch(() => {})
		}
	})

	it('escalates a stalled default stop when a force stop follows', async () => {
		let messageStarted!: () => void
		const activeMessage = new Promise<void>(
			(resolve) => (messageStarted = resolve)
		)
		// A lifecycle handler that never settles: the drain can only end by
		// being abandoned, never by the handler completing
		const never = new Promise<void>(() => {})
		let cleanups = 0
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message: async () => {
					messageStarted()
					await never
				}
			})
			.cleanup(() => cleanups++)
			.listen(0)
		const ws = newWebsocket(app.server!)

		try {
			await wsOpen(ws)
			ws.send('hold')
			await activeMessage

			let settled = false
			const stopping = app.stop()!.then(() => (settled = true))
			await Bun.sleep(20)
			expect(settled).toBe(false)
			expect(cleanups).toBe(0)

			void app.stop(true)

			let timer!: ReturnType<typeof setTimeout>
			const expired = new Promise<'timeout'>((resolve) => {
				timer = setTimeout(() => resolve('timeout'), 2000)
			})

			try {
				expect(
					await Promise.race([
						stopping.then(() => 'stopped' as const),
						expired
					])
				).toBe('stopped')
			} finally {
				clearTimeout(timer)
			}

			expect(cleanups).toBe(1)
			expect(app.server).toBeUndefined()
		} finally {
			ws.close()
			await app.stop(true)?.catch(() => {})
		}
	})

	it('restores an untouched ~ext after a released stop', async () => {
		const app = new Elysia().get('/', 'hi')
		expect(app['~ext']).toBeUndefined()

		app.listen(0)
		await Bun.sleep(0)
		await app.stop()

		// A listen epoch installs its stop/cleanup state on `~ext`; releasing
		// the epoch must not leave the app holding it
		expect(app['~ext']).toBeUndefined()
	})
})
