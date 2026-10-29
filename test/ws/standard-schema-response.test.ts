import { describe, expect, it } from 'bun:test'
import * as v from 'valibot'
import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsClosed, wsMessage, wsOpen } from './utils'

const schema = v.object({ ok: v.boolean() })
const handlers = {
	returned: (value: unknown) => () => value,
	promise: (value: unknown) => () => Promise.resolve(value),
	generator: (value: unknown) =>
		function* () {
			yield value
		},
	asyncGenerator: (value: unknown) =>
		async function* () {
			yield value
		},
	send: (value: unknown) => (ws: any) => {
		ws.send(value)
	}
}

describe('WebSocket Standard Schema responses', () => {
	for (const [mode, handler] of Object.entries(handlers))
		for (const valid of [true, false])
			it(`${mode} ${valid ? 'delivers valid' : 'rejects invalid'} messages`, async () => {
				const value = valid ? { ok: true } : { ok: 'not a boolean' }
				const app = new Elysia()
					.use(websocket())
					.ws('/ws', {
						response: schema,
						message: handler(value) as any
					})
					.listen(0)
				const ws = newWebsocket(app.server!)

				try {
					await wsOpen(ws)
					const message = wsMessage(ws)
					ws.send('trigger')
					const frame = String((await message).data)
					if (valid) expect(frame).toBe(JSON.stringify(value))
					else expect(frame).not.toBe(JSON.stringify(value))
				} finally {
					await wsClosed(ws)
					await app.stop(true)
				}
			})
})
