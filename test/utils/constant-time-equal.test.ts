import { describe, expect, it } from 'bun:test'
import { constantTimeEqual } from '../../src/utils'

describe('constantTimeEqual', () => {
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

	it('works when node:crypto timingSafeEqual is available', () => {
		const nc = (globalThis.process as any)?.getBuiltinModule?.(
			'node:crypto'
		)
		expect(typeof nc?.timingSafeEqual).toBe('function')

		expect(constantTimeEqual('abc', 'abc')).toBe(true)
		expect(constantTimeEqual('abc', 'xyz')).toBe(false)
	})
})
