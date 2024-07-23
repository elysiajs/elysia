import { describe, it, expect } from 'bun:test'
import { extractMainParameter } from '../../src/sucrose'

describe('extract main parameter', () => {
	it('extract main parameter when there is no spread operator and only one parameter', () => {
		const parameter = 'param1'
		const result = extractMainParameter(parameter)
		expect(result).toBe('param1')
	})

	it('extract main parameter when there is a spread operator and only one parameter', () => {
		const parameter = '{ ...param1 }'
		const result = extractMainParameter(parameter)
		expect(result).toBe('param1')
	})

	it('extract main parameter when there are multiple parameters and a spread operator', () => {
		const parameter = '{ param1, param2, ...param3 }'
		const result = extractMainParameter(parameter)
		expect(result).toBe('param3')
	})

	it('return undefined when parameter is an empty string', () => {
		const parameter = ''
		const result = extractMainParameter(parameter)
		expect(result).toBeUndefined()
	})

	it('return undefined when parameter is undefined', () => {
		const parameter = undefined
		// @ts-expect-error
		const result = extractMainParameter(parameter)
		expect(result).toBeUndefined()
	})

	it('return undefined when parameter is null', () => {
		const parameter = null
		// @ts-expect-error
		const result = extractMainParameter(parameter)
		expect(result).toBeUndefined()
	})
})
