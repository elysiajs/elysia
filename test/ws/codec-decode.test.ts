// Message and upgrade schemas decode codecs and strip undeclared fields.
import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

describe('WebSocket schema decoding', () => {
	it('decodes Date and Numeric in message bodies', async () => {
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({ when: t.Date(), n: t.Numeric() }),
				message(ws, body: any) {
					ws.send(
						JSON.stringify({
							whenIsDate: body.when instanceof Date,
							iso:
								body.when instanceof Date
									? body.when.toISOString()
									: null,
							n: body.n,
							nType: typeof body.n
						})
					)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		const message = wsMessage(ws)

		ws.send(JSON.stringify({ when: '2020-01-01T00:00:00.000Z', n: '42' }))

		const { data } = await message
		expect(JSON.parse(data as string)).toEqual({
			whenIsDate: true,
			iso: '2020-01-01T00:00:00.000Z',
			n: 42,
			nType: 'number'
		})

		await wsClosed(ws)
		app.stop()
	})

	it('rejects invalid codec messages without calling the handler', async () => {
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({ when: t.Date() }),
				message(ws) {
					ws.send('ok')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		const message = wsMessage(ws)

		ws.send(JSON.stringify({ when: 'not-a-date' }))

		const { data } = await message
		expect(typeof data).toBe('string')
		expect((data as string).length).toBeGreaterThan(0)
		expect(data).not.toBe('ok')

		await wsClosed(ws)
		app.stop()
	})

	it('accepts declared fields for schemas without codecs', async () => {
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({ text: t.String() }),
				message(ws, { text }: any) {
					ws.send(text)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		const message = wsMessage(ws)

		ws.send(JSON.stringify({ text: 'hello' }))

		const { data } = await message
		expect(data).toBe('hello')

		await wsClosed(ws)
		app.stop()
	})

	it('strips undeclared properties from message bodies', async () => {
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({ a: t.String() }),
				message(ws, body: any) {
					ws.send(JSON.stringify(body))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		const message = wsMessage(ws)

		ws.send(JSON.stringify({ a: 'hi', evil: 'INJECTED', nested: { x: 1 } }))

		const { data } = await message
		expect(JSON.parse(data as string)).toEqual({ a: 'hi' })

		await wsClosed(ws)
		app.stop()
	})

	it('strips undeclared query parameters during upgrade', async () => {
		const app = new Elysia()
			.ws('/ws', {
				query: t.Object({ room: t.String() }),
				message({ ws, query }: any) {
					ws.send(JSON.stringify(query))
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?room=1&b=2&admin=true`
		)
		await wsOpen(ws)
		const message = wsMessage(ws)

		ws.send('ping')

		const { data } = await message
		expect(JSON.parse(data as string)).toEqual({ room: '1' })

		await wsClosed(ws)
		app.stop()
	})
})
