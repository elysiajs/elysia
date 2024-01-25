import { describe, expect, it } from 'bun:test'
import { isNumericString } from '../../src/utils'

describe('Numeric string', () => {
	it('valid string', async () => {
		expect(isNumericString('69')).toBe(true)
		expect(isNumericString('69.420')).toBe(true)
		expect(isNumericString('00093281')).toBe(true)
	})

	it('invalid string', async () => {
		expect(isNumericString('pizza')).toBe(false)
		expect(isNumericString('69,420')).toBe(false)
		expect(isNumericString('0O093281')).toBe(false)
		expect(isNumericString(crypto.randomUUID())).toBe(false)
	})
})
