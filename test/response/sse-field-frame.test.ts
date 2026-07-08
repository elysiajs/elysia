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

	it('single-line data produces exact frame bytes', () => {
		const event = sse('hello')

		expect(event.toSSE()).toBe('data: hello\n\n')
	})

	it('multi-line LF data produces one data line per line', () => {
		const event = sse('a\nb')

		expect(event.toSSE()).toBe('data: a\ndata: b\n\n')
	})

	it('lone-CR data produces same output as LF data', () => {
		const crEvent = sse('a\rb')
		const lfEvent = sse('a\nb')

		expect(crEvent.toSSE()).toBe(lfEvent.toSSE())
	})

	it('CRLF data produces same output as LF data', () => {
		const crlfEvent = sse('a\r\nb')
		const lfEvent = sse('a\nb')

		expect(crlfEvent.toSSE()).toBe(lfEvent.toSSE())
	})
})
