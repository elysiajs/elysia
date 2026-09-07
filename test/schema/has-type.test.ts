import { describe, it, expect } from 'bun:test'

import { t } from '../../src'
import { hasType } from './has-type'
import { ELYSIA_TYPES } from '../../src/type/constants'

describe('hasType schema traversal', () => {
	it('finds a primitive kind through a codec', () => {
		const schema = t
			.Codec(t.File())
			.Decode((v) => v)
			.Encode((v) => v)

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('finds a kind in an object property', () => {
		const schema = t.Object({
			liyue: t.File()
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('finds a kind in a nested object property', () => {
		const schema = t.Object({
			liyue: t.Object({
				id: t.File()
			})
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('finds a kind inside t.Optional', () => {
		const schema = t.Optional(
			t.Object({
				prop1: t.File()
			})
		)

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('finds one of multiple matching properties', () => {
		const schema = t.Object({
			id: t.File(),
			name: t.File()
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('returns false when the kind is absent', () => {
		const schema = t.Object({
			name: t.String(),
			age: t.Number()
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(false)
	})

	it('finds a kind in a union property', () => {
		const schema = t.Object({
			id: t.Number(),
			liyue: t.Union([t.Number(), t.File()])
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('finds a kind in a root union', () => {
		const schema = t.Union([
			t.Object({
				id: t.Number(),
				liyue: t.File()
			}),
			t.Object({
				id: t.Number(),
				liyue: t.Number()
			})
		])

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('finds a File through a module reference', () => {
		const schema = t.Module({
			Avatar: t.File()
		}).Avatar

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('finds a File in an object through a module reference', () => {
		const schema = t.Module({
			Upload: t.Object({
				name: t.String(),
				file: t.File()
			})
		}).Upload

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('returns false for a module reference without a File', () => {
		const schema = t.Module({
			User: t.Object({
				name: t.String(),
				age: t.Number()
			})
		}).User

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(false)
	})

	it('finds a File in a union through a module reference', () => {
		const schema = t.Module({
			Data: t.Union([t.Object({ file: t.File() }), t.Null()])
		}).Data

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('recognizes an array of File as Files through a module reference', () => {
		const schema = t.Module({
			Uploads: t.Array(t.File())
		}).Uploads

		expect(hasType(ELYSIA_TYPES.Files, schema)).toBe(true)
	})

	it('finds t.Files through a module reference', () => {
		const schema = t.Module({
			Uploads: t.Files()
		}).Uploads

		expect(hasType(ELYSIA_TYPES.Files, schema)).toBe(true)
	})

	it('recognizes a root array of File as Files', () => {
		const schema = t.Array(t.File())

		expect(hasType(ELYSIA_TYPES.Files, schema)).toBe(true)
	})

	it('finds a root t.Files schema', () => {
		const schema = t.Files()

		expect(hasType(ELYSIA_TYPES.Files, schema)).toBe(true)
	})

	it('finds a kind in a root intersection', () => {
		const schema = t.Intersect([
			t.Object({
				id: t.Number()
			}),
			t.Object({
				file: t.File()
			})
		])

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('returns false for an intersection without the kind', () => {
		const schema = t.Intersect([
			t.Object({
				id: t.Number()
			}),
			t.Object({
				name: t.String()
			})
		])

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(false)
	})

	it('finds a kind in a union nested in an intersection', () => {
		const schema = t.Intersect([
			t.Object({
				id: t.Number()
			}),
			t.Union([t.Object({ file: t.File() }), t.Null()])
		])

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('finds a File in an intersection through a module reference', () => {
		const schema = t.Module({
			Data: t.Intersect([
				t.Object({ id: t.Number() }),
				t.Object({ file: t.File() })
			])
		}).Data

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})
})
