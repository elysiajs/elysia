/**
 * WS message bodies with codec schemas (Date / Numeric / etc.) are now DECODED
 * before the handler runs, matching HTTP body handling. Previously WS validated
 * with `.Check` only, so a `t.Date()` message arrived as a raw string. The fix
 * gates `.From` on `hasCodec`; plain (codec-less) schemas take a cheaper
 * Check-then-Clean path (no Decode), which also strips undeclared properties to
 * match HTTP's mass-assignment behavior.
 *
 * See the performance/memory investigation (CYCLE 8 — WS codec decode) and the
 * stable security gate (WS mass-assignment parity, 2026-07-10).
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

	it('plain (codec-less) message body passes through the declared field (Check-then-Clean path)', async () => {
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

	// Security regression: a plain WS body schema must strip undeclared
	// attacker-supplied fields, exactly like the equivalent HTTP route. Before
	// the fix the WS path Check'd but did not Clean, so extra fields reached the
	// handler (mass-assignment parity gap). WHY it matters: an app that forwards
	// `ws.body` into a DB write / Object.assign trusts the declared shape.
	it('strips undeclared properties from a plain body (mass-assignment parity with HTTP)', async () => {
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

		ws.send(
			JSON.stringify({ a: 'hi', evil: 'INJECTED', nested: { x: 1 } })
		)

		const { data } = await message
		expect(JSON.parse(data as string)).toEqual({ a: 'hi' })

		await wsClosed(ws)
		app.stop()
	})

	// Security regression: the WS upgrade channel (query/params/headers) must
	// strip undeclared props too, matching HTTP — which strips all three when a
	// schema is declared. Before the fix validateUpgradeChannel was Check-only,
	// so an attacker's extra query params reached the handler over WS.
	it('strips undeclared query params on the WS upgrade (parity with HTTP)', async () => {
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
