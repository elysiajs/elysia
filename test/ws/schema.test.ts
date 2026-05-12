import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

describe('WebSocket non-body schemas', () => {
	it('query: success — typed query is accessible inside handler', async () => {
		const app = new Elysia()
			.ws('/ws', {
				query: t.Object({ name: t.String() }),
				message({ ws, query }: any) {
					ws.send(`hi-${query.name}`)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?name=jane`
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('hi-jane')

		await wsClosed(ws)
		app.stop()
	})

	it('query: failure — upgrade is rejected with HTTP 422', async () => {
		const app = new Elysia()
			.ws('/ws', {
				query: t.Object({ name: t.String() }),
				message({ ws }: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		// Missing `name` query param — upgrade should be rejected.
		const upgradeResponse = await fetch(
			`http://${app.server!.hostname}:${app.server!.port}/ws`,
			{
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-version': '13'
				}
			}
		)

		expect(upgradeResponse.status).toBe(422)

		app.stop()
	})

	it('params: dynamic path param validated at upgrade', async () => {
		const app = new Elysia()
			.ws('/ws/:id', {
				params: t.Object({ id: t.String() }),
				message({ ws, params }: any) {
					ws.send(`id=${params.id}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws/42')
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('id=42')

		await wsClosed(ws)
		app.stop()
	})

	it('headers: success — typed headers usable in handler', async () => {
		const app = new Elysia()
			.ws('/ws', {
				headers: t.Object({
					'x-token': t.String()
				}),
				message({ ws, headers }: any) {
					ws.send(`token=${headers['x-token']}`)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws`,
			{
				// Bun's WebSocket constructor accepts a `headers` field via
				// its options arg (BunWebSocketOptions). Used at handshake.
				headers: { 'x-token': 'abc' }
			} as any
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('token=abc')

		await wsClosed(ws)
		app.stop()
	})

	it('headers: failure — upgrade rejected when required header missing', async () => {
		const app = new Elysia()
			.ws('/ws', {
				headers: t.Object({
					'x-token': t.String()
				}),
				message({ ws }: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const upgradeResponse = await fetch(
			`http://${app.server!.hostname}:${app.server!.port}/ws`,
			{
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-version': '13'
				}
			}
		)

		expect(upgradeResponse.status).toBe(422)

		app.stop()
	})

	it('upgrade-time validation errors route through .onError()', async () => {
		let seenCode: string | undefined
		let seenOn: string | undefined

		const app = new Elysia()
			.onError(({ error, code }: any) => {
				seenCode = code
				seenOn = (error as any)?.type
				return new Response('caught:' + (error as any)?.type, {
					status: 418
				})
			})
			.ws('/ws', {
				query: t.Object({ name: t.String() }),
				message({ ws }: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const response = await fetch(
			`http://${app.server!.hostname}:${app.server!.port}/ws`,
			{
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-version': '13'
				}
			}
		)

		expect(response.status).toBe(418)
		expect(await response.text()).toBe('caught:query')
		expect(seenCode).toBe('VALIDATION')
		expect(seenOn).toBe('query')

		app.stop()
	})

	it('query: Standard Schema (zod) success and failure both honored', async () => {
		const z = await import('zod')
		const app = new Elysia()
			.ws('/ws', {
				query: z.object({ name: z.string() }),
				message({ ws, query }: any) {
					ws.send(`hi-${query.name}`)
				}
			})
			.listen(0)

		// Success path.
		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?name=zoe`
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('hi-zoe')

		await wsClosed(ws)

		// Failure path.
		const upgradeResponse = await fetch(
			`http://${app.server!.hostname}:${app.server!.port}/ws`,
			{
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-version': '13'
				}
			}
		)
		expect(upgradeResponse.status).toBe(422)

		app.stop()
	})
})
