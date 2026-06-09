import { t } from '../../src'

import { describe, expect, it } from 'bun:test'

import { hasRef } from '../../src/schema'

describe('has Ref', () => {
	it('return true if object property has ref', () => {
		expect(
			hasRef(
				t.Object({
					a: t.String(),
					b: t.Ref('b'),
					c: t.Number()
				})
			)
		).toBe(true)
	})

	it('return false if object property does not have ref', () => {
		expect(
			hasRef(
				t.Object({
					a: t.Number(),
					b: t.String(),
					c: t.Number()
				})
			)
		).toBe(false)
	})

	it('return true if array property contains ref', () => {
		expect(
			hasRef(
				t.Object({
					a: t.String(),
					b: t.Ref('b'),
					c: t.Number()
				})
			)
		).toBe(true)
	})

	it('should return false if array does not contains ref', () => {
		expect(
			hasRef(
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

	it('return true if nested object property has ref', () => {
		expect(
			hasRef(
				t.Object({
					a: t.String(),
					b: t.Object({
						a: t.String(),
						b: t.Array(t.Ref('b')),
						c: t.Number()
					}),
					c: t.Number()
				})
			)
		).toBe(true)
	})

	it('return true if ref is inside array', () => {
		expect(hasRef(t.Ref('b'))).toBe(true)
	})

	it('return true if ref root', () => {
		expect(hasRef(t.Ref('b'))).toBe(true)
	})

	it('return true if nested object property is inside Union', () => {
		expect(
			hasRef(
				t.Object({
					a: t.String(),
					b: t.Union([t.String(), t.Array(t.Ref('b'))])
				})
			)
		).toBe(true)
	})

	it('return true if nested object property is inside Intersect', () => {
		expect(
			hasRef(
				t.Object({
					a: t.String(),
					b: t.Intersect([t.String(), t.Array(t.Ref('b'))])
				})
			)
		).toBe(true)
	})

	it('return true if Ref is inside Union', () => {
		expect(
			hasRef(
				t.Union([
					t.Object({ foo: t.String() }),
					t.Object({
						field: t.Ref('b')
					})
				])
			)
		).toEqual(true)
	})

	it('return true if Ref is inside Intersect', () => {
		expect(
			hasRef(
				t.Intersect([
					t.Object({ foo: t.String() }),
					t.Object({
						field: t.Ref('b')
					})
				])
			)
		).toEqual(true)
	})

	it('return true if Ref is inside Transform', () => {
		expect(
			hasRef(
				t
					.Transform(t.Object({ id: t.Ref('b') }))
					.Decode((value) => value.id)
					.Encode((value) => ({
						id: value
					}))
			)
		).toBe(true)
	})

	it('return true if Ref is the root', () => {
		expect(hasRef(t.Ref('b'))).toBe(true)
	})
})
