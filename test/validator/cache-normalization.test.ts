import { afterEach, describe, expect, it } from 'bun:test'

import { t } from '../../src'
import { Validator } from '../../src/validator'

describe('validator cache normalization modes', () => {
	afterEach(() => {
		Validator.clear()
	})

	it('separates validators with different normalization modes', () => {
		const vTypebox: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'typebox'
		})
		const vMirror: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'exactMirror'
		})

		expect(vTypebox).not.toBe(vMirror)
		expect(vTypebox.Clean).not.toBe(vMirror.Clean)
	})

	it('reuses a validator for an equivalent schema and mode', () => {
		const a: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'exactMirror'
		})
		const b: any = Validator.create(t.Object({ a: t.String() }), {
			normalize: 'exactMirror'
		})

		expect(a).toBe(b)
	})
})
