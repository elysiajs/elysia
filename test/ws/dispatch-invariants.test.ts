import { describe, it, expect } from 'bun:test'
import { Elysia, t, status } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

describe('WebSocket event dispatch', () => {
	// A generator return terminates iteration; only yielded values are messages.
	it('generator return value is not sent as a trailing message', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message: function* ({ body }: any) {
					yield `a:${body}`
					yield `b:${body}`
					return `ret:${body}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got: string[] = []
		ws.onmessage = (e) => got.push(String(e.data))
		ws.send('hi')
		await Bun.sleep(30)

		expect(got).toEqual(['a:hi', 'b:hi'])

		await wsClosed(ws)
		app.stop()
	})

	it('async generator return value is not sent', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				message: async function* ({ body }: any) {
					yield `a:${body}`
					return `ret:${body}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got: string[] = []
		ws.onmessage = (e) => got.push(String(e.data))
		ws.send('hi')
		await Bun.sleep(30)

		expect(got).toEqual(['a:hi'])

		await wsClosed(ws)
		app.stop()
	})

	it('skips response validation when the returned status has no validator', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				response: {
					200: t.Object({ ok: t.Boolean() })
				},
				message({ body }: any): any {
					// The 503 body intentionally violates the registered 200 schema.
					if (body === 'fail') return status(503, { message: 'down' })
					return { ok: true }
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const m = wsMessage(ws)
		ws.send('fail')

		const parsed = JSON.parse((await m).data as string)
		expect(parsed).toEqual({ status: 503, error: { message: 'down' } })

		await wsClosed(ws)
		app.stop()
	})

	it('applies mapResponse to values returned by error handlers', async () => {
		const app = new Elysia()
			.error(() => {
				return 'caught'
			})
			.use(websocket()).ws('/ws', {
				message() {
					throw new Error('boom')
				},
				mapResponse({ responseValue }: any): any {
					return `mapped-${responseValue}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const m = wsMessage(ws)
		ws.send('hi')

		expect((await m).data).toBe('mapped-caught')

		await wsClosed(ws)
		app.stop()
	})

	it('isolates ws.body between concurrent ping handlers', async () => {
		const seen: { before: string; after: string }[] = []

		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				async ping(ws: any) {
					// Read ws.body again after the await to detect shared state.
					const before = String(ws.body)
					await Bun.sleep(before === 'slow' ? 40 : 1)
					seen.push({ before, after: String(ws.body) })
				},
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		;(ws as any).ping('slow')
		;(ws as any).ping('fast')

		await Bun.sleep(120)

		expect(seen.length).toBe(2)
		for (const r of seen) expect(r.after).toBe(r.before)
		expect(seen.map((r) => r.before).sort()).toEqual(['fast', 'slow'])

		await wsClosed(ws)
		app.stop()
	})
})
