import { describe, it, expect } from 'bun:test'

import { handleFile, responseToSetHeaders } from '../../src/adapter/utils'
import { Elysia } from '../../src'

// idx39: handleFile's Headers-instance branch must apply the accept-ranges /
// content-range defaults when they are ABSENT. The old `if (key in set.headers)`
// guard could never match (the `in` operator tests JS properties, not header
// entries) and was inverted, so the advisory range headers were silently dropped
// whenever set.headers was a Headers instance. WHY it matters: clients rely on
// `accept-ranges: bytes` to know range requests are supported.
describe('handleFile defaults on Headers instance (idx39)', () => {
	it('applies accept-ranges/content-range defaults when absent', () => {
		const body = new Blob(['12345'])
		const res = handleFile(body, {
			headers: new Headers({ 'x-custom': 'a' }),
			status: 200,
			cookie: undefined
		} as any)

		expect(res.headers.get('accept-ranges')).toBe('bytes')
		expect(res.headers.get('content-range')).toBe('bytes 0-4/5')
		// user-provided header is preserved
		expect(res.headers.get('x-custom')).toBe('a')
	})

	it('does not override a user-provided range header', () => {
		const body = new Blob(['12345'])
		const res = handleFile(body, {
			headers: new Headers({ 'accept-ranges': 'none' }),
			status: 200,
			cookie: undefined
		} as any)

		// present header must win — default must NOT be appended
		expect(res.headers.get('accept-ranges')).toBe('none')
	})
})

// idx41: responseToSetHeaders strips content-encoding because it blocks chunked
// streaming. When set.headers is a Headers instance, bracket access reads a JS
// property (always undefined), so the strip silently no-opped and the encoding
// header survived onto a response Elysia intends to stream. WHY it matters: a
// stale content-encoding on a chunked stream can prevent/corrupt streaming.
describe('responseToSetHeaders strips content-encoding (idx41)', () => {
	it('removes content-encoding when set.headers is a Headers instance', () => {
		const set = {
			headers: new Headers({
				'content-encoding': 'gzip',
				'content-type': 'text/plain'
			}),
			status: 200
		}

		const out = responseToSetHeaders(new Response('hi'), set as any)

		// The boundary rework normalizes a `Headers`-instance `set.headers` to a
		// plain-object `Record` (so every downstream write lands correctly), so
		// read the result shape-agnostically. Intent is unchanged: the
		// streaming-blocking content-encoding is stripped, unrelated headers stay.
		const read = (key: string) =>
			out.headers instanceof Headers
				? out.headers.get(key)
				: (out.headers as Record<string, string>)[key]

		expect(read('content-encoding') ?? null).toBeNull()
		// unrelated headers are untouched
		expect(read('content-type')).toBe('text/plain')
	})

	it('still removes content-encoding on a plain-object set.headers', () => {
		const set = {
			headers: { 'content-encoding': 'gzip' } as Record<string, string>,
			status: 200
		}

		const out = responseToSetHeaders(new Response('hi'), set as any)

		expect(
			(out.headers as Record<string, string>)['content-encoding']
		).toBeUndefined()
	})
})

// idx40 (createRouteMap TDZ) retired 2026-07-03: src/adapter/bun/router.ts was
// dead code duplicating the fetch pipeline and has been deleted (L17).

// idx25: a custom parse function exact-matches on the content-type. `main`
// truncated the header at the first `;`, but the kiana rewrite passed the full
// `application/json; charset=utf-8` to parsers / `c.contentType`, breaking
// exact-match parsers. WHY it matters: a parser keyed on the bare media type
// silently stops matching once a charset parameter is present.
describe('contentType truncated at the first ; (idx25)', () => {
	it('hands the bare media type to a custom parser and c.contentType', async () => {
		let seen: string | undefined

		const app = new Elysia().post(
			'/',
			{
				parse: ({ contentType, request }) => {
					seen = contentType
					// exact-match parser, as a user would write it
					if (contentType === 'application/json')
						return request.json()
				}
			},
			({ body }) => body
		)

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json; charset=utf-8' },
				body: '{"ok":true}'
			})
		)

		expect(seen).toBe('application/json')
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ ok: true })
	})
})
