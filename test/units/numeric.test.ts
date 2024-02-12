import { describe, expect, it } from 'bun:test'
import { isNumericString } from '../../src/utils'

describe('Numeric string', () => {
	it('valid string', async () => {
		expect(isNumericString('69')).toBe(true)
		expect(isNumericString('69.420')).toBe(true)
		expect(isNumericString('00093281')).toBe(true)
		expect(isNumericString(Number.MAX_SAFE_INTEGER.toString())).toBe(true)
	})

	it('invalid string', async () => {
		expect(isNumericString('pizza')).toBe(false)
		expect(isNumericString('69,420')).toBe(false)
		expect(isNumericString('0O093281')).toBe(false)
		expect(isNumericString(crypto.randomUUID())).toBe(false)
		expect(isNumericString('9007199254740995')).toBe(false)
		expect(isNumericString('123456789012345678')).toBe(false)
		expect(isNumericString('123123.999999999999')).toBe(false)
	})

	it('invalid on empty', async () => {
		expect(isNumericString('')).toBe(false)
		expect(isNumericString(' ')).toBe(false)
		expect(isNumericString('    ')).toBe(false)
	})

	it('start with number', async () => {
		expect(isNumericString('6AAAA')).toBe(false)
	})
})
