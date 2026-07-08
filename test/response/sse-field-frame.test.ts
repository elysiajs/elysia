import { describe, expect, it } from 'bun:test'

import { Elysia, sse } from '../../src'

describe('SSE field framing', () => {
	it('frames multiline string data as data lines', () => {
		const event = sse('one\ntwo\r\nthree')

		expect(event.toSSE()).toBe('data: one\ndata: two\ndata: three\n\n')
	})

	it('does not let id or event inject extra fields', () => {
		const event = sse({
			id: '1\nretry: 1',
			event: 'message\ndata: injected',
			data: 'ok'
		})

		expect(event.toSSE()).toBe(
			'id: 1retry: 1\nevent: messagedata: injected\ndata: ok\n\n'
		)
	})

	it('skips non-finite retry values', () => {
		const event = sse({
			retry: Number.NaN,
			data: 'ok'
		})

		expect(event.toSSE()).toBe('data: ok\n\n')
	})

	it('keeps streamed SSE content type', async () => {
		const app = new Elysia().get('/', async function* () {
			yield sse('ok')
		})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.headers.get('content-type')).toBe('text/event-stream')
		expect(await res.text()).toBe('data: ok\n\n')
	})
})
