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

	it('find in Import wrapping File', () => {
		const schema = t.Module({
			Avatar: t.File()
		}).Import('Avatar')

		expect(hasType('File', schema)).toBe(true)
	})

	it('find in Import wrapping Object with File', () => {
		const schema = t.Module({
			Upload: t.Object({
				name: t.String(),
				file: t.File()
			})
		}).Import('Upload')

		expect(hasType('File', schema)).toBe(true)
	})

	it('return false for Import wrapping Object without File', () => {
		const schema = t.Module({
			User: t.Object({
				name: t.String(),
				age: t.Number()
			})
		}).Import('User')

		expect(hasType('File', schema)).toBe(false)
	})

	it('find in Import wrapping Union with File', () => {
		const schema = t.Module({
			Data: t.Union([
				t.Object({ file: t.File() }),
				t.Null()
			])
		}).Import('Data')

		expect(hasType('File', schema)).toBe(true)
	})

	it('find in Import wrapping Array of Files', () => {
		const schema = t.Module({
			Uploads: t.Array(t.File())
		}).Import('Uploads')

		expect(hasType('Files', schema)).toBe(true)
	})

	it('find in Import wrapping Array of Files using t.Files', () => {
		const schema = t.Module({
			Uploads: t.Files()
		}).Import('Uploads')

		expect(hasType('Files', schema)).toBe(true)
	})

	it('find in Array of Files (direct)', () => {
		const schema = t.Array(t.File())

		expect(hasType('Files', schema)).toBe(true)
	})

	it('find in Array of Files using t.Files (direct)', () => {
		const schema = t.Files()

		expect(hasType('Files', schema)).toBe(true)
	})
})
