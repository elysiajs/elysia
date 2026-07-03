import { describe, it, expect } from 'bun:test'
import { mapResponse } from '../../../src/adapter/web-standard/handler'

// H13: a returned `Response` with an untouched `set` should pass through by
// reference (no rewrap allocation, no re-locking a single-use stream body),
// while a touched `set` still rewraps so headers/status are applied.
describe('mapResponse — Response pass-through (H13)', () => {
	it('returns a Response by reference when set is untouched', () => {
		const original = new Response('hi')
		expect(mapResponse(original, { headers: {} } as any)).toBe(original)
	})

	it('rewraps (not by reference) when set.status is assigned', () => {
		const original = new Response('hi')
		const res = mapResponse(original, { headers: {}, status: 201 } as any)
		expect(res).not.toBe(original)
		expect(res.status).toBe(201)
	})

	// C1: a touched set with the same status must NOT mutate the returned
	// Response in place — a shared/module-level Response would otherwise carry
	// one request's headers onto the next. It rewraps via response.body (which
	// preserves the in-memory body and its content-length) and leaves the
	// original untouched.
	it('rewraps and leaves the original untouched when set.headers is applied', () => {
		const original = new Response('hi')
		const res = mapResponse(original, {
			headers: { 'x-add': '1' }
		} as any)
		expect(res).not.toBe(original)
		expect(res.headers.get('x-add')).toBe('1')
		// the returned Response must not be mutated in place
		expect(original.headers.get('x-add')).toBeNull()
	})
})

// F29: the error.toResponse() flow (validation 422s, custom errors) reaches
// mapResponse with set.status already equal to the finished Response's own
// status — nothing would change, so the Response must pass through by
// reference instead of being torn apart and rewrapped as a stream body.
describe('mapResponse — no-op set pass-through (F29)', () => {
	it('passes a Response through by reference when set.status matches', () => {
		const original = new Response('error', { status: 422 })
		const res = mapResponse(original, {
			headers: {},
			status: 422
		} as any)
		expect(res).toBe(original)
	})

	it('rewraps when cookies are set', () => {
		const original = new Response('error', { status: 422 })
		const res = mapResponse(original, {
			headers: {},
			status: 422,
			cookie: { name: { value: 'hina' } }
		} as any)
		expect(res).not.toBe(original)
		expect(res.status).toBe(422)
		expect(res.headers.getAll('set-cookie')).toEqual(['name=hina'])
	})
})

// C1: header merge boundaries — mergeHeaders precedence (response wins) is
// applied onto a fresh clone (never the original), and set-cookie always falls
// back to the rewrap path so a shared/cached Response can never accumulate
// cookies.
describe('mapResponse — header merge (C1)', () => {
	it('response headers win over set.headers on the merged clone', () => {
		const original = new Response('hi', {
			headers: { 'x-a': 'response' }
		})
		const res = mapResponse(original, {
			headers: { 'x-a': 'set', 'x-b': 'set' }
		} as any)
		expect(res).not.toBe(original)
		expect(res.headers.get('x-a')).toBe('response')
		expect(res.headers.get('x-b')).toBe('set')
		// original stays as it was returned by the handler
		expect(original.headers.get('x-b')).toBeNull()
	})

	it('rewraps when set.headers carries set-cookie', () => {
		const original = new Response('hi')
		const res = mapResponse(original, {
			headers: { 'set-cookie': 'a=b' }
		} as any)
		expect(res).not.toBe(original)
		expect(res.headers.getAll('set-cookie')).toEqual(['a=b'])
		// in-place merge must be skipped: the original stays untouched
		expect(original.headers.get('set-cookie')).toBeNull()
	})
})

// C1: a `Response.body` is a one-shot ReadableStream. When a shared/module-level
// Response is returned from a header-setting route, the rewrap must TEE the body
// (via `response.clone().body`) so every request gets a fresh readable and the
// original stays consumable for the next hit. Rewrapping with the raw
// `response.body` transferred (locked) the stream, so request 1 worked and
// request 2 threw `ReadableStream has already been used` → HTTP 500. WHY this
// matters: returning a cached Response is an idiomatic micro-optimization; it
// must survive repeated use, not blow up on the 2nd request.
describe('mapResponse — shared Response body reuse (C1)', () => {
	it('rereads the body across repeated requests (teed, not consumed)', async () => {
		const shared = new Response('hello', {
			headers: { 'content-type': 'text/plain' }
		})

		for (let n = 1; n <= 3; n++) {
			const res = mapResponse(shared, {
				headers: { 'x-req': String(n) }
			} as any) as Response

			// body readable every time — the raw-body rewrap threw here on n===2
			expect(await res.text()).toBe('hello')
			expect(res.status).toBe(200)
			// content-type preserved from the original response
			expect(res.headers.get('content-type')).toBe('text/plain')
			// per-request header isolation: only this request's x-req is present
			expect(res.headers.get('x-req')).toBe(String(n))
		}

		// the shared original is never consumed or mutated by the rewrap
		expect(await shared.clone().text()).toBe('hello')
		expect(shared.headers.get('x-req')).toBeNull()
	})

	it('streams a shared chunked Response across repeated requests', async () => {
		// no content-length + transfer-encoding: chunked routes into the stream
		// branch, which consumes the CLONED body (never the original)
		const shared = new Response(
			new TextEncoder().encode('shared-chunk'),
			{ headers: { 'transfer-encoding': 'chunked' } }
		)

		const read = async (res: Response) => {
			const reader = res.body!.getReader()
			const dec = new TextDecoder()
			let out = ''
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				out += typeof value === 'string' ? value : dec.decode(value)
			}
			return out
		}

		for (let n = 1; n <= 3; n++) {
			const res = (await mapResponse(shared, {
				headers: { 'x-req': String(n) }
			} as any)) as Response

			expect(res.headers.get('transfer-encoding')).toBe('chunked')
			expect(res.headers.get('x-req')).toBe(String(n))
			expect(await read(res)).toBe('shared-chunk')
		}
	})
})
