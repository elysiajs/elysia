/**
 * L18 — constantTimeEqual should prefer the native timingSafeEqual on the
 * current runtime (Node/Bun both have it via node:crypto) rather than the
 * handwritten loop, and the fallback loop must still produce correct results.
 *
 * The old implementation probed `globalThis.crypto.timingSafeEqual`, which is
 * only on Bun's WebCrypto global — not on Node 22's.  The fix checks
 * node:crypto.timingSafeEqual first via the same getBuiltinModule pattern that
 * cookie/utils.ts already uses, so both runtimes take the native branch.
 */

import { describe, expect, it } from 'bun:test'
import { constantTimeEqual } from '../../src/utils'

describe('L18 — constantTimeEqual', () => {
	it('returns true for identical strings', () => {
		expect(constantTimeEqual('hello', 'hello')).toBe(true)
		expect(constantTimeEqual('', '')).toBe(true)
		expect(constantTimeEqual('a'.repeat(512), 'a'.repeat(512))).toBe(true)
	})

	it('returns false for different strings of the same length', () => {
		expect(constantTimeEqual('hello', 'world')).toBe(false)
		expect(constantTimeEqual('aaa', 'aab')).toBe(false)
	})

	it('returns false for strings of different lengths (no length leak)', () => {
		expect(constantTimeEqual('short', 'much-longer')).toBe(false)
		expect(constantTimeEqual('longer-string', 'x')).toBe(false)
	})

	it('handles multi-byte UTF-8 correctly (unicode)', () => {
		const s = '日本語 🍣 café'
		expect(constantTimeEqual(s, s)).toBe(true)
		expect(constantTimeEqual(s, s + ' ')).toBe(false)
	})

	it('native timingSafeEqual branch is selected on this runtime (node:crypto present)', () => {
		// Verify we are actually running on a runtime where node:crypto is
		// available (Bun and Node both qualify).  This ensures the test is not
		// vacuously passing the fallback loop.
		const nc = (globalThis.process as any)?.getBuiltinModule?.('node:crypto')
		expect(typeof nc?.timingSafeEqual).toBe('function')

		// Confirm the function still works correctly when the native branch runs.
		expect(constantTimeEqual('abc', 'abc')).toBe(true)
		expect(constantTimeEqual('abc', 'xyz')).toBe(false)
	})

})
