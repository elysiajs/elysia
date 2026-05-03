import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { req } from '../utils'

// Regression test for https://github.com/elysiajs/elysia/issues/1790
// Range header was ignored; always returned bytes 0-N/N instead of the requested slice.
describe('Range header', () => {
	const content = '12345'
	const app = new Elysia().get('/file', () => new Blob([content]))

	it('returns full file without Range header', async () => {
		const res = await app.handle(req('/file'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe(content)
	})

	it('handles bytes=start- (open-ended range)', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=3-' } })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 3-4/5')
		expect(res.headers.get('content-length')).toBe('2')
		expect(await res.text()).toBe('45')
	})

	it('handles bytes=start-end (bounded range)', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=1-3' } })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 1-3/5')
		expect(res.headers.get('content-length')).toBe('3')
		expect(await res.text()).toBe('234')
	})

	it('handles bytes=-suffix (last N bytes)', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=-2' } })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 3-4/5')
		expect(res.headers.get('content-length')).toBe('2')
		expect(await res.text()).toBe('45')
	})

	it('clamps end beyond file size to last byte', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=2-999' } })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 2-4/5')
		expect(await res.text()).toBe('345')
	})

	it('returns 416 when start is out of range', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=99-' } })
		)
		expect(res.status).toBe(416)
		expect(res.headers.get('content-range')).toBe('bytes */5')
	})

	it('returns 416 for invalid "bytes=-" (both positions empty)', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=-' } })
		)
		expect(res.status).toBe(416)
		expect(res.headers.get('content-range')).toBe('bytes */5')
	})

	it('ignores subsequent ranges in multi-range requests, uses first range only', async () => {
		// Multi-range (e.g. bytes=0-1,3-4) is not supported; only the first range is applied.
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=0-1,3-4' } })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 0-1/5')
		expect(await res.text()).toBe('12')
	})
})

// Regression test for the createResponseHandler always-rewrap behavior introduced
// in 1.4.23 (commit 0d9b0401, "fix: can't modify immutable headers"). The rewrap
// reads `response.body` as a generic ReadableStream, which severs the Bun.file
// association on the body and disables Bun.serve's automatic Range-request
// handling for `new Response(Bun.file())`. This is the response shape
// `@elysiajs/static` returns for every static asset, so the regression broke
// HTTP byte-range support for static media on Bun — most visibly, mobile Safari
// refusing to play `<video>` (Apple requires byte-range support for `<video>`).
describe('Range header — preserves body identity through createResponseHandler on Bun', () => {
	it('merges set.headers into the response without mutating the handler-owned Response', async () => {
		const original = new Response('hello', {
			headers: { 'x-from-handler': 'handler' }
		})
		const app = new Elysia()
			.onRequest(({ set }) => {
				set.headers['x-from-set'] = 'set'
			})
			.get('/file', () => original)

		const res = await app.handle(req('/file'))

		expect(res.headers.get('x-from-set')).toBe('set')
		expect(res.headers.get('x-from-handler')).toBe('handler')
		// The handler's Response object must remain pristine — handlers that
		// reuse a cached Response would otherwise leak headers across requests.
		expect(original.headers.get('x-from-set')).toBeNull()
	})

	it('does not leak set.headers across requests when the handler returns a shared Response', async () => {
		// A real bug: with in-place mutation of the handler's Response, the
		// second request would see the first request's headers because the
		// non-conflicting check (!target.has(key)) skips already-set keys.
		const shared = new Response('hello')
		let counter = 0
		const app = new Elysia()
			.onRequest(({ set }) => {
				set.headers['x-request-id'] = String(++counter)
			})
			.get('/file', () => shared)

		const port = 8092
		const server = app.listen(port)
		try {
			const r1 = await fetch(`http://localhost:${port}/file`)
			const r2 = await fetch(`http://localhost:${port}/file`)
			expect(r1.headers.get('x-request-id')).toBe('1')
			expect(r2.headers.get('x-request-id')).toBe('2')
			expect(shared.headers.get('x-request-id')).toBeNull()
		} finally {
			await server.stop(true)
		}
	})

	it('rewraps when status changes (the Bun fast path requires unchanged status)', async () => {
		const original = new Response('hello', { status: 200 })
		const app = new Elysia()
			.onRequest(({ set }) => {
				set.status = 201
			})
			.get('/file', () => original)

		const res = await app.handle(req('/file'))

		expect(res).not.toBe(original)
		expect(res.status).toBe(201)
		expect(await res.text()).toBe('hello')
	})

	it('serves byte-range responses for `new Response(Bun.file())` end-to-end', async () => {
		// The whole point of this patch: under the real Bun.serve runtime,
		// returning `new Response(Bun.file())` from a handler must still let
		// Bun.serve auto-handle Range, which it does by inspecting the body's
		// type. Cloning the response (rather than rewrapping or mutating)
		// preserves that body identity through Elysia's response chain.
		const tmp = `${import.meta.dir}/.range-fixture.bin`
		await Bun.write(tmp, 'abcdefghij') // 10 bytes

		const port = 8090
		const app = new Elysia().get('/file', () => new Response(Bun.file(tmp)))
		const server = app.listen(port)

		try {
			const res = await fetch(`http://localhost:${port}/file`, {
				headers: { range: 'bytes=2-5' }
			})

			expect(res.status).toBe(206)
			expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
			expect(res.headers.get('content-length')).toBe('4')
			expect(await res.text()).toBe('cdef')
		} finally {
			await server.stop(true)
			await Bun.file(tmp).delete()
		}
	})
})
