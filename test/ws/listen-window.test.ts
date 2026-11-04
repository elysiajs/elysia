import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'

import { newWebsocket, wsClose, wsClosed, wsOpen } from './utils'

// Bun fixes a socket's limits on the listener it arrived on, reload() cannot
// change them, so everything here connects while startup is still blocked.
const parkUpgrade = async (app: Elysia<any, any, any, any, any, any, any>) => {
	const ws = newWebsocket(app.server!)

	while (!app.server!.pendingRequests) await Bun.sleep(1)

	return ws
}

const outcome = (ws: WebSocket) =>
	new Promise<'open' | 'refused'>((resolve) => {
		ws.onopen = () => resolve('open')
		ws.onerror = () => resolve('refused')
	})

describe('WebSocket upgrade before listen() publishes', () => {
	it('upgrades a request parked behind an async onStart', async () => {
		const started = Promise.withResolvers<void>()
		const app = new Elysia()
			.use(websocket())
			.onStart(() => started.promise)
			.ws('/ws', {
				message(ws, message) {
					ws.send(`echo ${message}`)
				}
			})
			.listen(0)

		const ws = await parkUpgrade(app)
		started.resolve()
		await wsOpen(ws)

		const reply = new Promise<string>((resolve) => {
			ws.onmessage = (event) => resolve(event.data)
		})
		ws.send('hi')

		expect(await reply).toBe('echo hi')

		await wsClosed(ws)
		await app.stop(true)
	})

	it.each([
		[
			'.ws()',
			(message: () => void) =>
				new Elysia().use(websocket()).ws('/ws', {
					maxPayloadLength: 8,
					message
				})
		],
		[
			'websocket()',
			(message: () => void) =>
				new Elysia()
					.use(websocket({ maxPayloadLength: 8 }))
					.ws('/ws', { message })
		],
		[
			'a macro',
			(message: () => void) =>
				new Elysia()
					.use(websocket())
					.macro({ tight: { maxPayloadLength: 8 } as any })
					.ws('/ws', { tight: true, message })
		]
	])(
		'holds a parked socket to the maxPayloadLength from %s',
		async (_, plugin) => {
			let received = 0
			const started = Promise.withResolvers<void>()
			const app = new Elysia()
				.use(plugin(() => received++))
				.onStart(() => started.promise)
				.listen(0)

			const ws = await parkUpgrade(app)
			started.resolve()
			await wsOpen(ws)

			const closed = wsClose(ws)
			ws.send('x'.repeat(100))
			await closed

			expect(received).toBe(0)

			await app.stop(true)
		}
	)

	// a route tightens the server-wide limit: refusing beats opening
	// a socket that outlives a limit it never saw
	it('refuses a request parked behind an async plugin', async () => {
		const loaded = Promise.withResolvers<void>()
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', { message() {} })
			.use(async (app) => {
				await loaded.promise

				return app.ws('/strict', {
					maxPayloadLength: 8,
					message() {}
				})
			})
			.listen(0)

		const ws = await parkUpgrade(app)
		const result = outcome(ws)
		loaded.resolve()

		expect(await result).toBe('refused')

		await app.stop(true)
	})

	it('refuses when a macro introspect sets the limit', async () => {
		const started = Promise.withResolvers<void>()
		const app = new Elysia()
			.use(websocket())
			.macro({
				tight: {
					introspect(hook: any) {
						hook.maxPayloadLength = 8
					}
				}
			})
			.onStart(() => started.promise)
			.ws('/ws', { tight: true, message() {} })
			.listen(0)

		const ws = await parkUpgrade(app)
		const result = outcome(ws)
		started.resolve()

		expect(await result).toBe('refused')

		await app.stop(true)
	})

	it('refuses when a route is added after listen()', async () => {
		const started = Promise.withResolvers<void>()
		const app = new Elysia()
			.use(websocket())
			.onStart(() => started.promise)
			.ws('/ws', { message() {} })
			.listen(0)

		app.ws('/strict', { maxPayloadLength: 8, message() {} })

		const ws = await parkUpgrade(app)
		const result = outcome(ws)
		started.resolve()

		expect(await result).toBe('refused')

		await app.stop(true)
	})

	it('upgrades behind an async plugin that leaves the limits alone', async () => {
		const loaded = Promise.withResolvers<void>()
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', { maxPayloadLength: 8, message() {} })
			.use(async (app) => {
				await loaded.promise

				return app.get('/late', 'late')
			})
			.listen(0)

		const ws = await parkUpgrade(app)
		const result = outcome(ws)
		loaded.resolve()

		expect(await result).toBe('open')

		await wsClosed(ws)
		await app.stop(true)
	})

	it('still answers a parked HTTP request when upgrades are refused', async () => {
		const loaded = Promise.withResolvers<void>()
		const app = new Elysia()
			.use(websocket())
			.get('/', 'ok')
			.ws('/ws', { message() {} })
			.use(async (app) => {
				await loaded.promise

				return app.ws('/strict', {
					maxPayloadLength: 8,
					message() {}
				})
			})
			.listen(0)

		const response = fetch(`http://localhost:${app.server!.port}/`)
		while (!app.server!.pendingRequests) await Bun.sleep(1)
		loaded.resolve()

		expect(await (await response).text()).toBe('ok')

		await app.stop(true)
	})
})
