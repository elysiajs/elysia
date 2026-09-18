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

const throws5xx = () => {
	throw Object.assign(new Error('secret internal detail'), { status: 500 })
}

describe('WebSocket error redaction', () => {
	afterEach(() => {
		delete process.env.NODE_ENV
	})

	// A 4xx status is developer-authored intent, so its message is visible
	// in production just like the HTTP transport (`statusFallbackBody`).
	it('includes unexpected 4xx messages in production', async () => {
		process.env.NODE_ENV = 'production'

		await expect(frameFor(throws4xx)).resolves.toContain(
			'secret internal detail'
		)
	})

	it('redacts unexpected 5xx messages in production', async () => {
		process.env.NODE_ENV = 'production'

		await expect(frameFor(throws5xx)).resolves.toBe('Internal Server Error')
	})

	it('includes unexpected 4xx messages during development', async () => {
		delete process.env.NODE_ENV

		await expect(frameFor(throws4xx)).resolves.toContain(
			'secret internal detail'
		)
	})

	it('preserves explicit error response bodies in production', async () => {
		process.env.NODE_ENV = 'production'

		await expect(
			frameFor(() => status(403, 'Forbidden'))
		).resolves.toContain('Forbidden')
	})
})
