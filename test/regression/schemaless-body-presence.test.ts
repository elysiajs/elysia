/**
 * Regression: schema-less body routes gate parsing on body presence so a
 * bodyless POST resolves to `body: undefined` instead of erroring on an empty
 * parse. The gate now prefers the framing headers (Content-Length /
 * Transfer-Encoding) and only falls back to `request.body` when neither is
 * present — touching `request.body` materializes the stream and ~doubles the
 * subsequent parse. These tests pin the behavior across all framing variants so
 * the perf gate (header-first) can't silently break parsing.
 *
 * See the performance/memory investigation (cold-start / POST body path).
 */
import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

const json = { name: 'saltyaom', age: 21 }
const body = JSON.stringify(json)

describe('schema-less body presence gate', () => {
	const app = new Elysia().post('/json', ({ body }) => body ?? 'EMPTY')

	it('parses a body that carries Content-Length (served-request shape)', async () => {
		const res = await app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'content-length': String(body.length)
				},
				body
			})
		)
		expect(await res.json()).toEqual(json)
	})

	it('parses a body with NO framing headers (programmatic new Request)', async () => {
		// `new Request(url, { body })` carries a body but no Content-Length — the
		// fallback to request.body must still parse it.
		const res = await app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body
			})
		)
		expect(await res.json()).toEqual(json)
	})

	it('a bodyless POST (Content-Length: 0) is graceful, not a 4xx', async () => {
		const res = await app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'content-length': '0'
				}
			})
		)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('EMPTY')
	})

	it('a bodyless POST with no body at all is graceful', async () => {
		const res = await app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: { 'content-type': 'application/json' }
			})
		)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('EMPTY')
	})
})
