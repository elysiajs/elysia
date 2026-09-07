import { afterEach, describe, expect, it } from 'bun:test'

import { t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'

describe('production validation detail', () => {
	afterEach(() => {
		Validator.clear()
		delete process.env.NODE_ENV
	})

	it('applies masking when NODE_ENV changes after module import', () => {
		const v = new TypeBoxValidator(t.Object({ x: t.Number() }))

		process.env.NODE_ENV = ''
		let devPayload: any
		try {
			v.FromSync({ x: 'no' })
		} catch (error: any) {
			devPayload = error.payload
		}
		expect(Array.isArray(devPayload.errors)).toBe(true)

		process.env.NODE_ENV = 'production'
		let prodPayload: any
		try {
			v.FromSync({ x: 'no' })
		} catch (error: any) {
			prodPayload = error.payload
		}

		expect(prodPayload.errors).toBeUndefined()
		expect(prodPayload.expected).toBeUndefined()
		expect(prodPayload.found).toBeUndefined()
		expect(prodPayload.property).toBe('/x')
		expect(Object.keys(prodPayload).sort()).toEqual([
			'on',
			'property',
			'status',
			'title',
			'type'
		])
	})
})
