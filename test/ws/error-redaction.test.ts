import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, status } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

// Pins the security property: wsErrorFrameFallback must never echo raw
// error.message in production when error.response is undefined.
// WHY: a 4xx-tagged unexpected error (e.g. wrapped upstream error) leaks
// internal paths / hostnames / table names to the WS client if not redacted.
//
// isProduction() reads Bun.env / process.env.NODE_ENV at call time (lazy),
// so in-suite NODE_ENV toggling works correctly.

// Boot an app with the given message handler, trigger it once, return the
// error frame the client received.
const frameFor = async (message: () => unknown): Promise<string> => {
	const app = new Elysia().ws('/ws', { message }).listen(0)

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

describe('WS error frame — production redaction', () => {
	afterEach(() => {
		delete process.env.NODE_ENV
	})

	it('prod: unexpected 4xx error message is redacted', async () => {
		process.env.NODE_ENV = 'production'

		// WHY: the bug was that error.message was sent verbatim; the fix must
		// return '' for 4xx in production.
		expect(await frameFor(throws4xx)).not.toContain('secret internal detail')
	})

	it('dev: unexpected 4xx error message reaches client for debuggability', async () => {
		delete process.env.NODE_ENV

		// WHY: developers need the raw message to diagnose failures; suppressing
		// it in dev would mask bugs during local development.
		expect(await frameFor(throws4xx)).toContain('secret internal detail')
	})

	it('prod: intentional error with response reaches client unchanged', async () => {
		process.env.NODE_ENV = 'production'

		// WHY: status() builds an error with .response set — that branch is taken
		// first and must not be redacted; explicit 403 bodies are intentional.
		expect(await frameFor(() => status(403, 'Forbidden'))).toContain(
			'Forbidden'
		)
	})
})
