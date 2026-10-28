import { describe, expect, it } from 'bun:test'

import { Elysia, redirect, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'

import { newWebsocket, wsClosed, wsMessage, wsOpen } from './utils'

// A schemaless handler's return is typed `unknown` (so an echo compiles), and
// a Response or Blob JSON-encoded to "{}" as a frame: it now sends its body.
const reply = async (message: (ws: any) => unknown, schema?: object) => {
	const app = new Elysia()
		.use(websocket())
		.ws('/ws', { ...schema, message: message as any })
		.listen(0)

	// listen() publishes the WebSocket handler once the app is built (later
	// with a schema): a socket opened before that fails its upgrade, so wait
	// for a plain request, which is held until then
	await fetch(`http://${app.server!.hostname}:${app.server!.port}/ws`)

	const ws = newWebsocket(app.server!)
	ws.binaryType = 'arraybuffer'
	await wsOpen(ws)
	ws.send('go')

	const { data } = await wsMessage(ws)

	await wsClosed(ws)
	app.stop()

	return data as unknown
}

const bytes = (data: unknown) => [...new Uint8Array(data as ArrayBuffer)]

describe('WebSocket HTTP body return', () => {
	it('sends a text Response as its text', async () => {
		expect(await reply(() => new Response('hello'))).toBe('hello')
	})

	it('sends a JSON Response as its JSON text', async () => {
		expect(await reply(() => Response.json({ a: 1 }))).toBe('{"a":1}')
	})

	it('awaits an async handler Response', async () => {
		expect(await reply(async () => new Response('later'))).toBe('later')
	})

	it('sends a binary Response as bytes', async () => {
		const data = await reply(
			() =>
				new Response(new Uint8Array([1, 2, 3]), {
					headers: { 'content-type': 'application/octet-stream' }
				})
		)

		expect(data).toBeInstanceOf(ArrayBuffer)
		expect(bytes(data)).toEqual([1, 2, 3])
	})

	it('sends a Blob as bytes', async () => {
		const data = await reply(
			() => new Blob([new Uint8Array([4, 5])], { type: 'text/plain' })
		)

		expect(data).toBeInstanceOf(ArrayBuffer)
		expect(bytes(data)).toEqual([4, 5])
	})

	it('sends a File as bytes', async () => {
		const data = await reply(() => new File(['hi'], 'a.txt'))

		expect(bytes(data)).toEqual([104, 105])
	})

	it('sends a Blob a generator yields as bytes', async () => {
		const data = await reply(function* () {
			yield new Blob([new Uint8Array([6])])
		})

		expect(bytes(data)).toEqual([6])
	})

	// control: already binary before
	it('sends an ArrayBuffer and a typed array as bytes', async () => {
		expect(bytes(await reply(() => new Uint8Array([7, 8]).buffer))).toEqual(
			[7, 8]
		)
		expect(bytes(await reply(() => new Uint8Array([9])))).toEqual([9])
	})

	it('validates a Response body against the response schema', async () => {
		const schema = { response: t.Literal('ok') }

		expect(await reply(() => new Response('ok'), schema)).toBe('ok')
		expect(await reply(() => new Response('nope'), schema)).not.toBe('nope')
	})

	// a redirect is a body-less Response: nothing to send
	it('sends nothing for a returned redirect', async () => {
		expect(
			await reply(function* () {
				yield redirect('/elsewhere')
				yield 'after'
			})
		).toBe('after')
	})

	// an error hook's answer goes the same way: one that fails to send is
	// named in an error frame, not dropped
	it('sends an error frame when an error-hook answer fails to send', async () => {
		const app = new Elysia()
			.use(websocket())
			.onError(({ error }) =>
				(error as Error).message === 'boom'
					? new Response(
							new ReadableStream({
								pull(controller) {
									controller.error(new Error('body broke'))
								}
							})
						)
					: undefined
			)
			.ws('/ws', {
				message() {
					throw new Error('boom')
				}
			})
			.listen(0)

		await fetch(`http://${app.server!.hostname}:${app.server!.port}/ws`)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		ws.send('go')

		expect(String((await wsMessage(ws)).data)).toContain('body broke')

		await wsClosed(ws)
		app.stop()
	})

	// telling an HTTP body apart reads the prototype, which a Proxy can trap:
	// that throw is the handler's error, so the error hooks see it
	for (const kind of ['sync', 'async'] as const)
		it(`hands a ${kind} return whose prototype trap throws to onError`, async () => {
			const hostile = new Proxy(
				{},
				{
					getPrototypeOf() {
						throw new Error('prototype trap')
					}
				}
			)

			let seen: unknown
			const app = new Elysia()
				.use(websocket())
				.onError(({ error }) => {
					seen = (error as Error).message
					return 'caught'
				})
				.ws('/ws', {
					message: (kind === 'async'
						? async () => hostile
						: () => hostile) as any
				})
				.listen(0)

			await fetch(`http://${app.server!.hostname}:${app.server!.port}/ws`)

			const ws = newWebsocket(app.server!)
			await wsOpen(ws)
			ws.send('go')

			expect((await wsMessage(ws)).data).toBe('caught')
			expect(seen).toBe('prototype trap')

			await wsClosed(ws)
			app.stop()
		})

	// the common case keeps its shape
	it('still sends plain strings and objects as before', async () => {
		expect(await reply(() => 'text')).toBe('text')
		expect(await reply(() => ({ ok: true }))).toBe('{"ok":true}')
		expect(await reply(() => [1, 2])).toBe('[1,2]')
	})
})
