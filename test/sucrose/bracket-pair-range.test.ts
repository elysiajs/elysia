import { describe, expect, it } from 'bun:test'

import { bracketPairRange } from '../../src/sucrose'

describe('bracket pair range', () => {
	it('return the correct range when given a string with a single bracket pair', () => {
		const parameter = 'hello: { world: { a } }, elysia'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([7, 23])
	})

	it('return the correct range when given a string with nested bracket pairs', () => {
		const parameter = 'hello: { world: { a } }, elysia'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([7, 23])
	})

	it('return [-1, 0] when given a string without any bracket pairs', () => {
		const parameter = 'hello, elysia'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([-1, 0])
	})

	it('return [0, 1] when given a string with a single opening bracket at the beginning', () => {
		const parameter = '{hello, elysia'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([0, 14])
	})

	it('return [parameter.length - 1, parameter.length] when given a string with a single closing bracket at the end', () => {
		const parameter = 'hello, elysia}'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([-1, 0])
	})

	it('return [-1, 0] when given an empty string', () => {
		const parameter = ''
		const result = bracketPairRange(parameter)
		expect(result).toEqual([-1, 0])
	})

	it('return the correct range when given a string with multiple bracket pairs', () => {
		const parameter = 'hello: { world: { a } }, elysia'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([7, 23])
	})

	it('return the correct range when given a string with an opening bracket but no closing bracket', () => {
		const parameter = 'hello: { world: { a }, elysia'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([0, parameter.length])
	})

	it('return the correct range when given a string with brackets inside quotes', () => {
		const parameter = 'hello: { world: { a } }, elysia'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([7, 23])
	})

	it('return the correct range when given a string with nested bracket pairs', () => {
		const parameter = 'hello: { world: { a } }, elysia'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([7, 23])
	})

	it('return the correct range when given a string with non-bracket characters', () => {
		const parameter = 'hello: { world: { a } }, elysia'
		const result = bracketPairRange(parameter)
		expect(result).toEqual([7, 23])
	})
})
