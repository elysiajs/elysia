import { describe, it, expect } from 'bun:test'

import { t } from '../../src'
import { hasTransform } from '../../src/schema'

describe('Has Transform', () => {
	it('find primitive', () => {
		const schema = t
			.Transform(t.String())
			.Decode((v) => v)
			.Encode((v) => v)

		expect(hasTransform(schema)).toBe(true)
	})

	it('find in root object', () => {
		const schema = t.Object({
			liyue: t
				.Transform(t.String())
				.Decode((v) => v)
				.Encode((v) => v)
		})

		expect(hasTransform(schema)).toBe(true)
	})

	it('find in nested object', () => {
		const schema = t.Object({
			liyue: t.Object({
				id: t
					.Transform(t.String())
					.Decode((v) => v)
					.Encode((v) => v)
			})
		})

		expect(hasTransform(schema)).toBe(true)
	})

	it('find in Optional', () => {
		const schema = t.Optional(
			t.Object({
				prop1: t
					.Transform(t.String())
					.Decode((v) => v)
					.Encode((v) => v)
			})
		)

		expect(hasTransform(schema)).toBe(true)
	})

	it('find on multiple transform', () => {
		const schema = t.Object({
			id: t
				.Transform(t.String())
				.Decode((v) => v)
				.Encode((v) => v),
			name: t
				.Transform(t.String())
				.Decode((v) => v)
				.Encode((v) => v)
		})

		expect(hasTransform(schema)).toBe(true)
	})

	it('return false on not found', () => {
		const schema = t.Object({
			name: t.String(),
			age: t.Number()
		})

		expect(hasTransform(schema)).toBe(false)
	})

	it('found on Union', () => {
		const schema = t.Object({
			id: t.Number(),
			liyue: t.Union([
				t
					.Transform(t.String())
					.Decode((v) => v)
					.Encode((v) => v),
				t.Number()
			])
		})

		expect(hasTransform(schema)).toBe(true)
	})

	it('Found t.Numeric', () => {
		const schema = t.Object({
			id: t.Numeric(),
			liyue: t.String()
		})

		expect(hasTransform(schema)).toBe(true)
	})

	it('Found t.ObjectString', () => {
		const schema = t.Object({
			id: t.String(),
			liyue: t.ObjectString({
				name: t.String()
			})
		})

		expect(hasTransform(schema)).toBe(true)
	})
})
