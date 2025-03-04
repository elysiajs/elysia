import { describe, it, expect } from 'bun:test'

import { t } from '../../src'
import { hasType } from '../../src/schema'

describe('Has Transform', () => {
	it('find primitive', () => {
		const schema = t
			.Transform(t.File())
			.Decode((v) => v)
			.Encode((v) => v)

		expect(hasType('File', schema)).toBe(true)
	})

	it('find in root object', () => {
		const schema = t.Object({
			liyue: t.File()
		})

		expect(hasType('File', schema)).toBe(true)
	})

	it('find in nested object', () => {
		const schema = t.Object({
			liyue: t.Object({
				id: t.File()
			})
		})

		expect(hasType('File', schema)).toBe(true)
	})

	it('find in Optional', () => {
		const schema = t.Optional(
			t.Object({
				prop1: t.File()
			})
		)

		expect(hasType('File', schema)).toBe(true)
	})

	it('find on multiple transform', () => {
		const schema = t.Object({
			id: t.File(),
			name: t.File()
		})

		expect(hasType('File', schema)).toBe(true)
	})

	it('return false on not found', () => {
		const schema = t.Object({
			name: t.String(),
			age: t.Number()
		})

		expect(hasType('File', schema)).toBe(false)
	})

	it('found on Union', () => {
		const schema = t.Object({
			id: t.Number(),
			liyue: t.Union([t.Number(), t.File()])
		})

		expect(hasType('File', schema)).toBe(true)
	})
})
