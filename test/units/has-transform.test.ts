import { t } from '../../src'

import { describe, expect, it } from 'bun:test'

import { hasTransform } from '../../src/schema'

describe('has transform', () => {
	it('return true if object property has Transform', () => {
		expect(
			hasTransform(
				t.Object({
					a: t.String(),
					b: t.Numeric(),
					c: t.Number()
				})
			)
		).toBe(true)
	})

	it('return false if object property does not have Transform', () => {
		expect(
			hasTransform(
				t.Object({
					a: t.Number(),
					b: t.String(),
					c: t.Number()
				})
			)
		).toBe(false)
	})

	it('return true if array property contains Transform', () => {
		expect(
			hasTransform(
				t.Object({
					a: t.String(),
					b: t.Numeric(),
					c: t.Number()
				})
			)
		).toBe(true)
	})

	it('should return false if array does not contains Transform', () => {
		expect(
			hasTransform(
				t.Array(
					t.Object({
						a: t.Number(),
						b: t.String(),
						c: t.Number()
					})
				)
			)
		).toBe(false)
	})

	it('return true if nested object property has Transform', () => {
		expect(
			hasTransform(
				t.Object({
					a: t.String(),
					b: t.Object({
						a: t.String(),
						b: t.Array(t.Numeric()),
						c: t.Number()
					}),
					c: t.Number()
				})
			)
		).toBe(true)
	})

	it('return true if Transform is inside array', () => {
		expect(hasTransform(t.Numeric())).toBe(true)
	})

	it('return true if Transform root', () => {
		expect(hasTransform(t.Numeric())).toBe(true)
	})

	it('return true if nested object property is inside Union', () => {
		expect(
			hasTransform(
				t.Object({
					a: t.String(),
					b: t.Union([t.String(), t.Array(t.Numeric())])
				})
			)
		).toBe(true)
	})

	it('return true if nested object property is inside Intersect', () => {
		expect(
			hasTransform(
				t.Object({
					a: t.String(),
					b: t.Intersect([t.String(), t.Array(t.Numeric())])
				})
			)
		).toBe(true)
	})

	it('return true if Transform is inside Intersect', () => {
		expect(
			hasTransform(
				t.Intersect([
					t.Object({ foo: t.String() }),
					t.Object({
						field: t
							.Transform(t.String())
							.Decode((decoded) => ({ decoded }))
							.Encode((v) => v.decoded)
					})
				])
			)
		).toEqual(true)
	})

	it('return true if Transform is inside Union', () => {
		expect(
			hasTransform(
				t.Union([
					t.Object({ foo: t.String() }),
					t.Object({
						field: t
							.Transform(t.String())
							.Decode((decoded) => ({ decoded }))
							.Encode((v) => v.decoded)
					})
				])
			)
		).toEqual(true)
	})

	it('return true when Transform is the root', () => {
		expect(
			hasTransform(
				t
					.Transform(t.Object({ id: t.String() }))
					.Decode((value) => value.id)
					.Encode((value) => ({
						id: value
					}))
			)
		).toBe(true)
	})
})
