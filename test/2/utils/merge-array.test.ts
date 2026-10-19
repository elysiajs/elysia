import { describe, it, expect } from 'bun:test'
import { mergeArray } from '../../../src/utils'

describe('mergeArray', () => {
	describe('undefined operands', () => {
		it('returns the second operand when the first is undefined', () => {
			expect(mergeArray(undefined, [1, 2])).toEqual([1, 2])
		})

		it('returns the first operand when the second is undefined', () => {
			expect(mergeArray([1, 2], undefined)).toEqual([1, 2])
		})

		it('returns a scalar second operand without wrapping it', () => {
			expect(mergeArray(undefined, 'x' as any)).toBe('x')
		})

		it('returns a scalar first operand without wrapping it', () => {
			expect(mergeArray('x' as any, undefined)).toBe('x')
		})

		it('reverse flag is ignored when one side is undefined', () => {
			expect(mergeArray(undefined, [1, 2], true)).toEqual([1, 2])
			expect(mergeArray([1, 2], undefined, true)).toEqual([1, 2])
		})
	})

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
			// @ts-expect-error scalar pairs are supported at runtime
			expect(mergeArray(1, 2)).toEqual([1, 2])
		})
	})

	describe('reverse order (reverse=true)', () => {
		it('array + array', () => {
			expect(mergeArray([1, 2], [3, 4], true)).toEqual([3, 4, 1, 2])
		})

		it('array + one-element array', () => {
			expect(mergeArray([1, 2, 3], [9], true)).toEqual([9, 1, 2, 3])
		})

		it('array + single', () => {
			expect(mergeArray([1, 2], 9, true)).toEqual([9, 1, 2])
		})

		it('single + array', () => {
			expect(mergeArray(9, [1, 2], true)).toEqual([1, 2, 9])
		})

		it('single + single', () => {
			// @ts-expect-error scalar pairs are supported at runtime
			expect(mergeArray(1, 2, true)).toEqual([2, 1])
		})
	})

	describe('mutation contract', () => {
		it('forward array+array: mutates a, leaves b intact', () => {
			const a = [1, 2]
			const b = [3, 4]
			const snapshot = [...b]
			const result = mergeArray(a, b)
			expect(result).toBe(a)
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
			expect(result).not.toBe(b)
		})

		it('reverse array+array, b.length === 1: mutates a, leaves b intact', () => {
			const a = [1, 2]
			const b = [9]
			const result = mergeArray(a, b, true)
			expect(result).toBe(a)
			expect(a).toEqual([9, 1, 2])
			expect(b).toEqual([9])
		})

		it('reverse array+single: mutates a (unshift)', () => {
			const a = [1, 2]
			const result = mergeArray(a, 9, true)
			expect(result).toBe(a)
			expect(a).toEqual([9, 1, 2])
		})

		it('does not mutate the second array when the first operand is scalar', () => {
			const second = [1, 2]
			mergeArray('a' as any, second)
			expect(second).toEqual([1, 2])
			mergeArray('a' as any, second, true)
			expect(second).toEqual([1, 2])
		})
	})

	describe('behavior', () => {
		it('preserves duplicate values', () => {
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
			// @ts-expect-error mixed nullable values are supported at runtime
			expect(mergeArray([NaN], [null, undefined])).toEqual([
				NaN,
				null,
				undefined
			])
		})
	})
})
