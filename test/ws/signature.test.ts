import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

describe('WebSocket .ws() signature', () => {
	it('3-arg form: positional message handler echoes back', async () => {
		const app = new Elysia()
			.ws(
				'/ws',
				({ ws, body }: any) => {
					ws.send(`echo:${body}`)
				}
			)
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

	it('3-arg form with options: open + close hooks coexist with positional handler', async () => {
		const order: string[] = []

		const app = new Elysia()
			.ws(
				'/ws',
				({ body }: any) => `msg:${body}`,
				{
					open: () => {
						order.push('open')
					},
					close: () => {
						order.push('close')
					}
				}
			)
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('A')
		expect((await got).data).toBe('msg:A')

		await wsClosed(ws)
		// Give server's close handler time to run.
		await Bun.sleep(20)
		app.stop()

		expect(order).toEqual(['open', 'close'])
	})

	it('3-arg form: generator function as positional handler', async () => {
		const app = new Elysia()
			.ws(
				'/ws',
				function* ({ body }: any) {
					yield `${body}-1`
					yield `${body}-2`
				}
			)
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got: string[] = []
		const pending = new Promise<string[]>((resolve) => {
			ws.onmessage = (e) => {
				got.push(String(e.data))
				if (got.length === 2) resolve(got)
			}
		})

		ws.send('x')
		expect(await pending).toEqual(['x-1', 'x-2'])

		await wsClosed(ws)
		app.stop()
	})

	it('3-arg form: schema in options validates per message', async () => {
		const app = new Elysia()
			.ws(
				'/ws',
				({ ws, body }: any) => ws.send(body.text),
				{
					body: t.Object({ text: t.String() })
				}
			)
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send(JSON.stringify({ text: 'ok' }))
		expect((await got).data).toBe('ok')

		await wsClosed(ws)
		app.stop()
	})

	it('conflict: message in both positional and options throws at registration', () => {
		expect(() => {
			new Elysia().ws(
				'/ws',
				() => 'positional',
				{ message: () => 'options' } as any
			)
		}).toThrow(/cannot specify 'message'/)
	})

	it('2-arg form (legacy) continues to work unchanged', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws: any, body: any) {
					ws.send(`legacy:${body}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('hi')

		const { data } = await got
		expect(data).toBe('legacy:hi')

		await wsClosed(ws)
		app.stop()
	})
})
