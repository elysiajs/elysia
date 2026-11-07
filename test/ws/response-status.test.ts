import { describe, expect, it } from 'bun:test'

import { Elysia, status, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsClosed, wsMessage, wsOpen } from './utils'

// A status frame is validated and redacted by the schema of the status it
// carries: a named code by its number, a numeric string by its number
describe('WebSocket response schema picked by status', () => {
	it('redacts a status frame by the schema of its status', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				response: {
					200: t.String(),
					201: t.Object({ a: t.String() }),
					404: t.Object({ a: t.String() })
				},
				message({ body }: any): any {
					const leaky = { a: 'x', leak: 'secret' }

					if (body === 'named') return status('Created', leaky)
					if (body === 'number') return status(404, leaky)
					return status('404' as any, leaky)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		try {
			for (const [body, code] of [
				['named', 201],
				['number', 404],
				['string', '404']
			] as const) {
				const m = wsMessage(ws)
				ws.send(body)

				expect(JSON.parse((await m).data as string)).toEqual({
					status: code,
					error: { a: 'x' }
				})
			}
		} finally {
			await wsClosed(ws)
			app.stop()
		}
	})
})
