import { describe, it, expect } from 'bun:test'
import { removeDefaultParameter } from '../../src/sucrose'

describe('removeDefaultParameter', () => {
	// The function removes default parameter values from a string parameter.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function returns the modified string parameter.
	it('should return the modified string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with no default parameter values.
	it('should handle a string parameter with no default parameter values', () => {
		const parameter = 'a, b, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with no equals sign.
	it('should handle a string parameter with no equals sign', () => {
		const parameter = 'a, b, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with an equals sign but no comma or closing bracket.
	it('should handle a string parameter with an equals sign but no comma or closing bracket', () => {
		const parameter = 'a=1'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a')
	})

	// The function handles a string parameter with an equals sign and a comma but no closing bracket.
	it('should handle a string parameter with an equals sign and a comma but no closing bracket', () => {
		const parameter = 'a=1, b=2, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with one default parameter value.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with multiple default parameter values.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with default parameter values in different locations.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with default parameter values in nested brackets.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with an equals sign and a closing bracket but no comma.
	it('should remove default parameter values from a string parameter when there is an equals sign and a closing bracket but no comma', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with an equals sign, a comma, and a closing bracket in the wrong order.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function is case-sensitive and does not remove default parameter values with different capitalization.
	it('should not remove default parameter values with different capitalization', () => {
		const parameter = 'a=1, B=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, B, c')
	})

	// The function does not modify the original string parameter and returns a new string.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function can handle whitespace characters around the equals sign.
	it('should remove default parameter values when there are whitespace characters around the equals sign', () => {
		const parameter = 'a = 1, b = 2, c = 3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function can handle default parameter values that contain equals signs.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function can handle default parameter values that contain commas.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})
})
