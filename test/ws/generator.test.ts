import { describe, it, expect } from 'bun:test'
import { Elysia, t, status } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

function collectMessages(ws: WebSocket, n: number): Promise<string[]> {
	return new Promise((resolve) => {
		const got: string[] = []
		ws.onmessage = (e) => {
			got.push(String(e.data))
			if (got.length >= n) resolve(got)
		}
	})
}

describe('WebSocket generator handlers', () => {
	it('message: sync generator yields are each sent as messages', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message: function* ({ ws, body }: any) {
					yield `a:${body}`
					yield `b:${body}`
					yield `c:${body}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const messages = collectMessages(ws, 3)
		ws.send('hi')
		const got = await messages

		expect(got).toEqual(['a:hi', 'b:hi', 'c:hi'])

		await wsClosed(ws)
		app.stop()
	})

	it('3-arg form: positional generator handler streams yields', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', function* (ws) {
				void ws
				yield 'x:1'
				yield 'x:2'
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const messages = collectMessages(ws, 2)
		ws.send('hi')
		const got = await messages

		expect(got).toEqual(['x:1', 'x:2'])

		await wsClosed(ws)
		app.stop()
	})

	it('message: async generator yields are each sent as messages', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message: async function* ({ body }: any) {
					yield `a:${body}`
					await Bun.sleep(5)
					yield `b:${body}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const messages = collectMessages(ws, 2)
		ws.send('hi')
		const got = await messages

		expect(got).toEqual(['a:hi', 'b:hi'])

		await wsClosed(ws)
		app.stop()
	})

	it('open: generator yields are sent as initial messages on connect', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				open: function* () {
					yield 'hello'
					yield 'world'
				},
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		const messages = collectMessages(ws, 2)

		const got = await messages
		expect(got).toEqual(['hello', 'world'])

		await wsClosed(ws)
		app.stop()
	})

	it('close: server-initiated close flushes generator yields before close frame', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message(ws: any) {
					ws.close()
				},
				close: function* () {
					yield 'goodbye'
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const pending = new Promise<string[]>((resolve) => {
			const got: string[] = []
			ws.onmessage = (e) => got.push(String(e.data))
			ws.onclose = () => resolve(got)
		})

		ws.send('please close me')
		const got = await pending

		expect(got).toContain('goodbye')

		app.stop()
	})

	it('regular function returning a value sends it as a single message', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message: ({ body }: any) => `echo:${body}`
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('hi')

		const { data } = await got
		expect(data).toBe('echo:hi')

		await wsClosed(ws)
		app.stop()
	})

	it('thrown error mid-stream is sent via error hook; connection stays open', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				error: () => 'caught',
				message: function* ({ body }: any) {
					yield 'first'
					if (body === 'boom') throw new Error('A')
					yield 'second'
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const first = collectMessages(ws, 2)
		ws.send('boom')
		const got1 = await first
		expect(got1).toEqual(['first', 'caught'])

		const second = collectMessages(ws, 2)
		ws.send('ok')
		const got2 = await second
		expect(got2).toEqual(['first', 'second'])

		await wsClosed(ws)
		app.stop()
	})

	it('close receives destructured code and reason', async () => {
		let seenCode: number | undefined
		let seenReason: string | undefined

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message({ ws }: any) {
					ws.close(4242, 'bye')
				},
				close({ code, reason }: any) {
					seenCode = code
					seenReason = reason
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		ws.send('shut')

		await new Promise<void>((resolve) => {
			ws.onclose = () => resolve()
		})
		// Give the server-side close handler a tick to set the captured vars.
		await Bun.sleep(20)

		expect(seenCode).toBe(4242)
		expect(seenReason).toBe('bye')

		app.stop()
	})

	it('mapResponse runs per yield', async () => {
		const seen: unknown[] = []

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message: function* ({ body }: any) {
					yield `${body}-1`
					yield `${body}-2`
				},
				mapResponse({ responseValue }: any) {
					seen.push(responseValue)
					return responseValue
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const messages = collectMessages(ws, 2)
		ws.send('x')
		await messages

		expect(seen).toEqual(['x-1', 'x-2'])

		await wsClosed(ws)
		app.stop()
	})

	it('afterResponse fires exactly once per generator invocation', async () => {
		let afterResponseCount = 0

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message: function* ({ body }: any) {
					yield `${body}:1`
					yield `${body}:2`
					yield `${body}:3`
				},
				afterResponse() {
					afterResponseCount++
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const messages = collectMessages(ws, 3)
		ws.send('msg')
		await messages

		await Bun.sleep(20)
		expect(afterResponseCount).toBe(1)

		await wsClosed(ws)
		app.stop()
	})

	it('ping handler receives the ping payload via destructured body', async () => {
		let seen: unknown = undefined

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				ping({ body }: any) {
					seen = body
				},
				message() {}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws`
		)
		await wsOpen(ws)
		// Bun exposes ping on its WebSocket implementation.
		;(ws as any).ping('hello-ping')
		await Bun.sleep(30)

		expect(seen).toBeDefined()
		expect(String(seen)).toBe('hello-ping')

		await wsClosed(ws)
		app.stop()
	})

	it('status(code, body) is serialized as { status, error } JSON', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message({ ws, body }: any) {
					ws.send(status(404, `missing:${body}`))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('foo')

		const parsed = JSON.parse((await got).data as string)
		expect(parsed).toEqual({ status: 404, error: 'missing:foo' })

		await wsClosed(ws)
		app.stop()
	})

	// `ElysiaStatus` deliberately leaves `response` undefined for the codes
	// HTTP sends with no body, so the frame is the code alone. Testing the
	// unwrapped body before the wrapper turns all of them into `send(null)`,
	// which the runtime refuses — the socket then gets a 500 error frame
	// instead of the status the handler asked for.
	it.each([101, 204, 205, 304, 307, 308])(
		'frames a body-less status(%s) as { status } on both send and return',
		async (code) => {
			const app = new Elysia()
				.use(websocket())
				.ws('/send', {
					message({ ws }: any) {
						ws.send(status(code))
					}
				})
				.ws('/return', {
					message: () => status(code)
				})
				.listen(0)

			for (const path of ['/send', '/return']) {
				const ws = newWebsocket(app.server!, path)
				await wsOpen(ws)

				const got = wsMessage(ws)
				ws.send('go')

				expect(JSON.parse((await got).data as string)).toEqual({
					status: code
				})

				await wsClosed(ws)
			}

			app.stop()
		}
	)

	it('status-keyed response schema: 200 vs 400 validate the right shape', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				response: {
					200: t.Object({ ok: t.Boolean() }),
					400: t.Object({ reason: t.String() })
				},
				// Return the value so the pipeline sends it once.
				message({ body }: any) {
					if (body === 'bad')
						return status(400, { reason: 'too-bad' })
					return { ok: true }
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const m1 = wsMessage(ws)
		ws.send('ok')
		expect(JSON.parse((await m1).data as string)).toEqual({ ok: true })

		const m2 = wsMessage(ws)
		ws.send('bad')
		expect(JSON.parse((await m2).data as string)).toEqual({
			status: 400,
			error: { reason: 'too-bad' }
		})

		await wsClosed(ws)
		app.stop()
	})

	it('afterHandle fires exactly once per generator invocation', async () => {
		let afterHandleCount = 0

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message: function* ({ body }: any) {
					yield `${body}:1`
					yield `${body}:2`
					yield `${body}:3`
				},
				afterHandle() {
					afterHandleCount++
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const messages = collectMessages(ws, 3)
		ws.send('msg')
		await messages

		// Give afterHandle a tick to run.
		await Bun.sleep(20)
		expect(afterHandleCount).toBe(1)

		await wsClosed(ws)
		app.stop()
	})
})
