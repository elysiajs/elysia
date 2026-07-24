import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, status } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

// Unexpected errors must not expose their messages to production clients.
const frameFor = async (message: () => unknown): Promise<string> => {
	const app = new Elysia().use(websocket()).ws('/ws', { message }).listen(0)

	const ws = newWebsocket(app.server!)
	await wsOpen(ws)

	const msg = wsMessage(ws)
	ws.send('trigger')
	const { data } = await msg

	await wsClosed(ws)
	app.stop()

	return String(data)
}

const throws4xx = () => {
	throw Object.assign(new Error('secret internal detail'), { status: 403 })
}

describe('WebSocket error redaction', () => {
	afterEach(() => {
		delete process.env.NODE_ENV
	})

	it('redacts unexpected 4xx messages in production', async () => {
		process.env.NODE_ENV = 'production'

		expect(await frameFor(throws4xx)).not.toContain(
			'secret internal detail'
		)
	})

	it('includes unexpected 4xx messages during development', async () => {
		delete process.env.NODE_ENV

		expect(await frameFor(throws4xx)).toContain('secret internal detail')
	})

	it('preserves explicit error response bodies in production', async () => {
		process.env.NODE_ENV = 'production'

		expect(await frameFor(() => status(403, 'Forbidden'))).toContain(
			'Forbidden'
		)
	})
})
