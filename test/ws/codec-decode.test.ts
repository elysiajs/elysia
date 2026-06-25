/**
 * WS message bodies with codec schemas (Date / Numeric / etc.) are now DECODED
 * before the handler runs, matching HTTP body handling. Previously WS validated
 * with `.Check` only, so a `t.Date()` message arrived as a raw string. The fix
 * gates `.From` on `hasCodec`, so plain (codec-less) schemas keep the cheap
 * Check-only path with no extra allocation.
 *
 * See the performance/memory investigation (CYCLE 8 — WS codec decode).
 */
import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

describe('WebSocket codec message decode', () => {
	it('decodes Date and Numeric in the message body (parity with HTTP)', async () => {
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

		// wire form: both fields arrive as strings
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

	it('an invalid codec message still returns an error, not a crash', async () => {
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
		expect(data).not.toBe('ok') // handler must not have run on invalid input

		await wsClosed(ws)
		app.stop()
	})

	it('plain (codec-less) message body is unchanged (Check-only path)', async () => {
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
})
