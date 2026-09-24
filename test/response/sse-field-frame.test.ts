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

	// `data: 0` and `data: false` are real events; dropping them silently
	// loses a counter or flag update the client is waiting for
	it('frames number and boolean data', () => {
		expect(sse({ data: 0 }).toSSE()).toBe('data: 0\n\n')
		expect(sse({ data: 42 }).toSSE()).toBe('data: 42\n\n')
		expect(sse({ data: false }).toSSE()).toBe('data: false\n\n')
		expect(sse({ id: 1, data: true }).toSSE()).toBe('id: 1\ndata: true\n\n')
	})

	it('streams number data from a generator', async () => {
		const app = new Elysia().get('/', function* () {
			yield sse({ data: 1 })
			yield sse({ data: 0 })
		})

		const res = await app.handle(new Request('http://localhost/'))
		await expect(res.text()).resolves.toBe('data: 1\n\ndata: 0\n\n')
	})

	// A skipped `null` chunk returned from pull() without enqueueing, and the
	// stream never asked for the next one: the response hung forever
	it('skips null and undefined chunks without stalling', async () => {
		const app = new Elysia()
			.get('/sync', function* () {
				yield 'a'
				yield null
				yield undefined
				yield 'b'
			})
			.get('/async', async function* () {
				yield 'a'
				yield null
				yield 'b'
			})

		for (const path of ['/sync', '/async']) {
			const res = await app.handle(new Request(`http://localhost${path}`))
			const body = await Promise.race([
				res.text(),
				Bun.sleep(1000).then(() => 'stalled')
			])

			expect(body).toBe('ab')
		}
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
		await expect(res.text()).resolves.toBe('data: ok\n\n')
	})

	// A raw string yielded onto an SSE stream is attacker-reachable content:
	// proxying an upstream feed (`yield chunk`) is the canonical shape. A blank
	// line terminates the current event, so an unframed chunk can dispatch an
	// event the server never sent — firing the browser's
	// `addEventListener('takeover')` and poisoning `Last-Event-ID` for the
	// reconnect. Framing must not depend on the handler remembering `sse()`.
	it('does not let a raw yielded string forge a second event', async () => {
		const app = new Elysia().get('/', async function* () {
			yield sse('first')
			yield 'hello\n\nevent: takeover\ndata: {"admin":true}'
		})

		const body = await app
			.handle(new Request('http://localhost/'))
			.then((res) => res.text())

		// the payload survives — as data, on its own `data:` lines
		expect(body).toBe(
			'data: first\n\n' +
				'data: hello\ndata: \ndata: event: takeover\n' +
				'data: data: {"admin":true}\n\n'
		)
		// ...and never as a field of its own
		expect(body).not.toContain('\n\nevent: takeover')
	})

	// The fix is on the per-chunk streaming path, so the common case has to
	// stay byte-for-byte what it was — a newline-free chunk gets exactly one
	// `data:` line and one terminator, wrapped or not.
	it('keeps a newline-free raw chunk byte-identical to a wrapped one', async () => {
		const bodies: string[] = []

		for (const app of [
			new Elysia().get('/', async function* () {
				yield sse('ok')
			}),
			new Elysia().get('/', async function* () {
				yield sse('lead')
				yield 'ok'
			})
		])
			bodies.push(
				await app
					.handle(new Request('http://localhost/'))
					.then((res) => res.text())
			)

		expect(bodies[0]).toBe('data: ok\n\n')
		expect(bodies[1]).toBe('data: lead\n\ndata: ok\n\n')
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
