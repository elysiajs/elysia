import { describe, expect, it } from 'bun:test'

import { responseToSetHeaders } from '../../src/adapter/utils'

// Regression (audit H6): merging a returned/re-streamed Response's headers into
// `set` used a `key in set.headers` guard. On non-Bun runtimes that took the
// `for…entries()` branch, that guard meant a freshly-created empty `set.headers`
// received NOTHING (every header dropped), and an existing `set.headers` only
// had pre-existing keys updated — inconsistent with the Bun `Object.assign`
// path. Both branches must copy all response headers (except content-encoding).
describe('responseToSetHeaders', () => {
	it('copies all response headers into a fresh set', () => {
		const response = new Response('x', {
			headers: { 'content-type': 'application/xml', 'x-custom': '1' }
		})

		const set = responseToSetHeaders(response)

		expect(set?.headers['content-type']).toBe('application/xml')
		expect(set?.headers['x-custom']).toBe('1')
	})

	it('merges response headers into an existing set', () => {
		const response = new Response('x', {
			headers: { 'content-type': 'application/xml', 'x-custom': '1' }
		})

		const set = responseToSetHeaders(response, {
			headers: { 'x-pre': 'p' },
			status: undefined
		} as any)

		// pre-existing header kept, response headers added
		expect(set?.headers['x-pre']).toBe('p')
		expect(set?.headers['content-type']).toBe('application/xml')
		expect(set?.headers['x-custom']).toBe('1')
	})

	it('drops content-encoding to allow re-streaming', () => {
		const response = new Response('x', {
			headers: { 'content-encoding': 'gzip', 'x-keep': '1' }
		})

		const set = responseToSetHeaders(response)

		expect(set?.headers['content-encoding']).toBeUndefined()
		expect(set?.headers['x-keep']).toBe('1')
	})
})
