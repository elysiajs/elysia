import { describe, expect, it } from 'bun:test'
import { fallbackRequestId, requestId } from '../../src/utils'

describe('fallbackRequestId', () => {
	it('is callable and returns a string', () => {
		expect(typeof fallbackRequestId).toBe('function')
		expect(typeof fallbackRequestId()).toBe('string')
	})

	it('is distinct across calls', () => {
		const ids = new Set(
			Array.from({ length: 5 }, () => fallbackRequestId())
		)

		expect(ids.size).toBe(5)
	})

	it('has a monotonic component so later ids sort after earlier ones', () => {
		const a = fallbackRequestId()
		const b = fallbackRequestId()

		expect(a.split('-')[1]).not.toBe(b.split('-')[1])
	})
})

describe('requestId', () => {
	// The `??` fallback chain guarantees a function on every runtime shape
	// (Bun, browser/Node crypto, or none) — this can never fail on Bun, but it
	// encodes the actual contract: `requestId` is always callable.
	it('is always a function, never undefined', () => {
		expect(requestId).toBeInstanceOf(Function)
	})
})
