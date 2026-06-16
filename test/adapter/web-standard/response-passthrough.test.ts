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

	// F28: on Bun, response.headers is mutable — a touched set with the same
	// status merges headers in place instead of rewrapping via response.body,
	// keeping the in-memory body (and its content-length) intact.
	it('applies headers in place keeping the Response reference on Bun', () => {
		const original = new Response('hi')
		const res = mapResponse(original, {
			headers: { 'x-add': '1' }
		} as any)
		expect(res).toBe(original)
		expect(res.headers.get('x-add')).toBe('1')
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

// F28: in-place header merge boundaries — mergeHeaders precedence (response
// wins) is replicated exactly, and set-cookie always falls back to the
// rewrap path so a shared/cached Response can never accumulate cookies.
describe('mapResponse — in-place header merge (F28)', () => {
	it('response headers win over set.headers on the in-place merge', () => {
		const original = new Response('hi', {
			headers: { 'x-a': 'response' }
		})
		const res = mapResponse(original, {
			headers: { 'x-a': 'set', 'x-b': 'set' }
		} as any)
		expect(res).toBe(original)
		expect(res.headers.get('x-a')).toBe('response')
		expect(res.headers.get('x-b')).toBe('set')
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
