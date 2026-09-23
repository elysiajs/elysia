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

	// same UTF-16 length, different UTF-8 byte length: the native compare
	// throws on a byte-length mismatch, so it must be caught before it
	it('returns false without throwing on a byte-length-only mismatch', () => {
		expect(constantTimeEqual('é', 'e')).toBe(false)
		expect(constantTimeEqual('e', 'é')).toBe(false)
	})

	// node:crypto costs ~565 KB to materialise; Bun's global
	// crypto.timingSafeEqual is the same native compare, so verifying a signed
	// cookie on Bun must not load it. The native call count pins that the
	// compare really is the constant-time one (an early-exit compare would
	// return the same results). Runs in a child: the choice is memoised per
	// process and `bun test` shares one
	it.if(typeof Bun !== 'undefined')(
		'uses the native constant-time compare without loading node:crypto on Bun',
		() => {
			const utils = new URL('../../src/utils.ts', import.meta.url).pathname
			const { stdout, exitCode } = Bun.spawnSync({
				cmd: [
					process.execPath,
					'-e',
					`const requested = []
const original = process.getBuiltinModule.bind(process)
process.getBuiltinModule = (id) => (requested.push(id), original(id))
const proto = Object.getPrototypeOf(crypto)
const timingSafeEqual = proto.timingSafeEqual
let calls = 0
proto.timingSafeEqual = function (a, b) {
	calls++
	return timingSafeEqual.call(this, a, b)
}
const { constantTimeEqual } = await import(${JSON.stringify(utils)})
const results = [constantTimeEqual('abc', 'abc'), constantTimeEqual('abc', 'abd')]
const sameLength = calls
results.push(constantTimeEqual('é', 'e'))
console.log(JSON.stringify({ requested, results, sameLength, calls }))`
				],
				stdout: 'pipe',
				stderr: 'inherit'
			})

			expect(exitCode).toBe(0)
			expect(JSON.parse(stdout.toString())).toEqual({
				requested: [],
				results: [true, false, false],
				// one native compare per same-byte-length pair
				sameLength: 2,
				// a byte-length mismatch never reaches the native compare
				calls: 2
			})
		}
	)

	it('works when node:crypto timingSafeEqual is available', () => {
		const nc = (globalThis.process as any)?.getBuiltinModule?.(
			'node:crypto'
		)
		expect(typeof nc?.timingSafeEqual).toBe('function')

		expect(constantTimeEqual('abc', 'abc')).toBe(true)
		expect(constantTimeEqual('abc', 'xyz')).toBe(false)
	})
})
