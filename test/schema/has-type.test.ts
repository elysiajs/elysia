import { describe, it, expect } from 'bun:test'

import { t } from '../../src'
import { hasType } from './has-type'
import { ELYSIA_TYPES } from '../../src/type/constants'

describe('Has Type', () => {
	it('find primitive', () => {
		const schema = t
			.Codec(t.File())
			.Decode((v) => v)
			.Encode((v) => v)

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('find in root object', () => {
		const schema = t.Object({
			liyue: t.File()
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('find in nested object', () => {
		const schema = t.Object({
			liyue: t.Object({
				id: t.File()
			})
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('find in Optional', () => {
		const schema = t.Optional(
			t.Object({
				prop1: t.File()
			})
		)

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('find on multiple transform', () => {
		const schema = t.Object({
			id: t.File(),
			name: t.File()
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('return false on not found', () => {
		const schema = t.Object({
			name: t.String(),
			age: t.Number()
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(false)
	})

	it('found on Union', () => {
		const schema = t.Object({
			id: t.Number(),
			liyue: t.Union([t.Number(), t.File()])
		})

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('found on direct Union', () => {
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

	it('find in Import wrapping File', () => {
		const schema = t.Module({
			Avatar: t.File()
		}).Avatar

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('find in Import wrapping Object with File', () => {
		const schema = t.Module({
			Upload: t.Object({
				name: t.String(),
				file: t.File()
			})
		}).Upload

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('return false for Import wrapping Object without File', () => {
		const schema = t.Module({
			User: t.Object({
				name: t.String(),
				age: t.Number()
			})
		}).User

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(false)
	})

	it('find in Import wrapping Union with File', () => {
		const schema = t.Module({
			Data: t.Union([t.Object({ file: t.File() }), t.Null()])
		}).Data

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('find in Import wrapping Array of Files', () => {
		const schema = t.Module({
			Uploads: t.Array(t.File())
		}).Uploads

		expect(hasType(ELYSIA_TYPES.Files, schema)).toBe(true)
	})

	it('find in Import wrapping Array of Files using t.Files', () => {
		const schema = t.Module({
			Uploads: t.Files()
		}).Uploads

		expect(hasType(ELYSIA_TYPES.Files, schema)).toBe(true)
	})

	it('find in Array of Files (direct)', () => {
		const schema = t.Array(t.File())

		expect(hasType(ELYSIA_TYPES.Files, schema)).toBe(true)
	})

	it('find in Array of Files using t.Files (direct)', () => {
		const schema = t.Files()

		expect(hasType(ELYSIA_TYPES.Files, schema)).toBe(true)
	})

	// Intersect schema tests
	it('find on direct Intersect', () => {
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

	it('do not find on Intersect without File', () => {
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

	it('find on nested Union in Intersect', () => {
		const schema = t.Intersect([
			t.Object({
				id: t.Number()
			}),
			t.Union([t.Object({ file: t.File() }), t.Null()])
		])

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})

	it('find File in Intersect referenced via Module.Import()', () => {
		const schema = t.Module({
			Data: t.Intersect([
				t.Object({ id: t.Number() }),
				t.Object({ file: t.File() })
			])
		}).Data

		expect(hasType(ELYSIA_TYPES.File, schema)).toBe(true)
	})
})
