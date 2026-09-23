// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { clearSucroseCache, sucrose } from '../../src/sucrose'

describe('sucrose inference cache', () => {
	it('keeps inference isolated between distinct handlers', () => {
		clearSucroseCache()

		const query = sucrose((context: any) => context.query.name, undefined)
		const body = sucrose((context: any) => context.body, undefined)

		expect(query.query).toBe(true)
		expect(query.body).toBe(false)
		expect(body.body).toBe(true)
		expect(body.query).toBe(false)
	})

	it('returns the same inference for a cached handler', () => {
		clearSucroseCache()
		const handler = (context: any) => context.headers['x-auth']

		const first = sucrose(handler, undefined)
		const second = sucrose(handler, undefined)

		expect(second).toEqual(first)
	})

	// The tests above rely on `clearSucroseCache()` resetting state (it used to
	// be a silent no-op when called with `null`), so pin that it really drops
	// both the per-function and the per-source memo: a cleared handler must be
	// re-inferred into a fresh object rather than served from cache
	it('re-infers a handler after the cache is cleared', () => {
		const handler = (context: any) => context.body

		const first = sucrose(handler, undefined)
		expect(sucrose(handler, undefined)).toBe(first)

		clearSucroseCache()

		const fresh = sucrose(handler, undefined)
		expect(fresh).not.toBe(first)
		expect(fresh).toEqual(first)

		// same source text on a new function identity: only the source
		// memo could serve this, and it was cleared too
		const twin = new Function(`return (${handler})`)()
		expect(sucrose(twin, undefined)).toBe(fresh)

		clearSucroseCache()
		expect(sucrose(twin, undefined)).not.toBe(fresh)
	})
})
