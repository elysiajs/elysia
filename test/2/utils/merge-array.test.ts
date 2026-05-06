import { describe, it, expect } from 'bun:test'
import { mergeArray } from '../../../src/2/utils'

describe('mergeArray', () => {
	// falsy inputs
	// note: undefined only, empty array is truthy
	describe('falsy inputs', () => {
		it('returns b as-is when a is undefined', () => {
			expect(mergeArray(undefined, [1, 2])).toEqual([1, 2])
		})

		it('returns a as-is when b is undefined', () => {
			expect(mergeArray([1, 2], undefined)).toEqual([1, 2])
		})

		it('returns single b unwrapped when a is undefined', () => {
			// known quirk: type lies, runtime returns the bare value
			expect(mergeArray(undefined, 'x' as any)).toBe('x')
		})

		it('returns single a unwrapped when b is undefined', () => {
			expect(mergeArray('x' as any, undefined)).toBe('x')
		})

		it('reverse flag is ignored when one side is undefined', () => {
			expect(mergeArray(undefined, [1, 2], true)).toEqual([1, 2])
			expect(mergeArray([1, 2], undefined, true)).toEqual([1, 2])
		})
	})

	// forward order
	// covers all 4 (array|single) × (array|single)
	describe('forward order (reverse=false)', () => {
		it('array + array', () => {
			expect(mergeArray([1, 2], [3, 4])).toEqual([1, 2, 3, 4])
		})

		it('array + single', () => {
			expect(mergeArray([1, 2], 3)).toEqual([1, 2, 3])
		})

		it('single + array', () => {
			expect(mergeArray(1, [2, 3])).toEqual([1, 2, 3])
		})

		it('single + single', () => {
			// @ts-expect-error
			expect(mergeArray(1, 2)).toEqual([1, 2])
		})
	})

	// reverse order — same matrix
	// the b.length === 1 fast path
	describe('reverse order (reverse=true)', () => {
		it('array + array', () => {
			expect(mergeArray([1, 2], [3, 4], true)).toEqual([3, 4, 1, 2])
		})

		it('array + array, b.length === 1 (fast path)', () => {
			expect(mergeArray([1, 2, 3], [9], true)).toEqual([9, 1, 2, 3])
		})

		it('array + single', () => {
			expect(mergeArray([1, 2], 9, true)).toEqual([9, 1, 2])
		})

		it('single + array', () => {
			expect(mergeArray(9, [1, 2], true)).toEqual([1, 2, 9])
		})

		it('single + single', () => {
			// @ts-expect-error
			expect(mergeArray(1, 2, true)).toEqual([2, 1])
		})
	})

	// mutation contract
	// a may be mutated, b must NEVER be
	describe('mutation contract', () => {
		it('forward array+array: mutates a, leaves b intact', () => {
			const a = [1, 2]
			const b = [3, 4]
			const snapshot = [...b]
			const result = mergeArray(a, b)
			expect(result).toBe(a) // returned reference IS a
			expect(a).toEqual([1, 2, 3, 4])
			expect(b).toEqual(snapshot)
		})

		it('forward array+single: mutates a', () => {
			const a = [1, 2]
			const result = mergeArray(a, 3)
			expect(result).toBe(a)
			expect(a).toEqual([1, 2, 3])
		})

		it('reverse array+array, b.length > 1: leaves b intact (allocates new)', () => {
			const a = [1, 2]
			const b = [3, 4]
			const snapshot = [...b]
			const result = mergeArray(a, b, true)
			expect(result).toEqual([3, 4, 1, 2])
			expect(b).toEqual(snapshot)
			expect(result).not.toBe(b) // fresh allocation
		})

		it('reverse array+array, b.length === 1: mutates a, leaves b intact', () => {
			const a = [1, 2]
			const b = [9]
			const result = mergeArray(a, b, true)
			expect(result).toBe(a) // mutated a
			expect(a).toEqual([9, 1, 2])
			expect(b).toEqual([9])
		})

		it('reverse array+single: mutates a (unshift)', () => {
			const a = [1, 2]
			const result = mergeArray(a, 9, true)
			expect(result).toBe(a)
			expect(a).toEqual([9, 1, 2])
		})

		it('single+array branches do not mutate b', () => {
			const b = [1, 2]
			const snapshot = [...b]
			mergeArray(0 as any, b) // ⚠ 0 is falsy — uses different path. Use truthy:
			const b2 = [1, 2]
			mergeArray('a' as any, b2)
			expect(b2).toEqual([1, 2])
			mergeArray('a' as any, b2, true)
			expect(b2).toEqual([1, 2])
		})
	})

	// behavioral guarantees
	describe('behavior', () => {
		it('preserves duplicates (no dedup, unlike old Set version)', () => {
			expect(mergeArray([1, 2, 1], [2, 1])).toEqual([1, 2, 1, 2, 1])
		})

		it('preserves item identity by reference', () => {
			const obj = { x: 1 }
			const result = mergeArray([obj], [])
			expect(result[0]).toBe(obj)
		})

		it('handles empty array on a side', () => {
			expect(mergeArray([], [1, 2])).toEqual([1, 2])
			expect(mergeArray([1, 2], [])).toEqual([1, 2])
			expect(mergeArray([], [1, 2], true)).toEqual([1, 2])
			expect(mergeArray([1, 2], [], true)).toEqual([1, 2])
		})

		it('preserves order across larger arrays', () => {
			const a = Array.from({ length: 100 }, (_, i) => i)
			const b = Array.from({ length: 100 }, (_, i) => 100 + i)
			expect(mergeArray([...a], [...b])).toEqual([...a, ...b])
			expect(mergeArray([...a], [...b], true)).toEqual([...b, ...a])
		})

		it('preserves NaN, null, undefined as values', () => {
			// @ts-expect-error
			expect(mergeArray([NaN], [null, undefined])).toEqual([
				NaN,
				null,
				undefined
			])
		})
	})
})
