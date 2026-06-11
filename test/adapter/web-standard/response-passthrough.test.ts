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
	})

	it('rewraps and applies headers when set.headers is non-empty', () => {
		const original = new Response('hi')
		const res = mapResponse(original, {
			headers: { 'x-add': '1' }
		} as any)
		expect(res).not.toBe(original)
		expect(res.headers.get('x-add')).toBe('1')
	})
})
