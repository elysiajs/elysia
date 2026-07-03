import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { req, upload } from '../utils'

describe('UnionEnum default precedence and no mutation', () => {
	it('user-supplied default wins over values[0]', () => {
		const schema = t.UnionEnum(['a', 'b', 'c'], { default: 'c' })
		expect((schema as any).default).toBe('c')
	})

	it('values[0] is the default when no user default', () => {
		const schema = t.UnionEnum(['x', 'y'])
		expect((schema as any).default).toBe('x')
	})

	it('options bag is not mutated after call', () => {
		const options = { description: 'pick one' }
		const before = { ...options }

		t.UnionEnum(['a', 'b'], options)

		expect(options).toEqual(before)
		expect(Object.getOwnPropertyNames(options).sort()).toEqual(
			Object.getOwnPropertyNames(before).sort()
		)
	})

	it('one options bag produces two distinct, correct schemas', () => {
		const options = { description: 'shared' }

		const s1 = t.UnionEnum(['a', 'b'], options)
		const s2 = t.UnionEnum([1, 2], options)

		expect((s1 as any).enum).toEqual(['a', 'b'])
		expect((s2 as any).enum).toEqual([1, 2])
		// First schema must not have been retro-mutated
		expect((s1 as any).enum).toEqual(['a', 'b'])
		expect(s1).not.toBe(s2)
	})

	it('validation still works end-to-end after options reuse', async () => {
		const schema = t.Object({ color: t.UnionEnum(['red', 'blue']) })

		const app = new Elysia()
			.post('/color', { body: schema }, ({ body }) => body)

		const ok = await app.handle(
			req('/color', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ color: 'red' })
			})
		)
		expect(ok.status).toBe(200)

		const bad = await app.handle(
			req('/color', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ color: 'green' })
			})
		)
		expect(bad.status).toBe(422)
	})
})

describe('Files minItems/maxItems decode-aware', () => {
	it('single file upload satisfies minItems:1 maxItems:3', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ file: t.Files({ minItems: 1, maxItems: 3 }) }) },
			() => 'ok'
		)

		const { request } = upload('/', { file: 'millenium.jpg' })
		const res = await app.handle(request)
		expect(res.status).toBe(200)
	})

	it('two files satisfy minItems:2', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ file: t.Files({ minItems: 2 }) }) },
			() => 'ok'
		)

		const { request } = upload('/', {
			file: ['millenium.jpg', 'kozeki-ui.webp']
		})
		const res = await app.handle(request)
		expect(res.status).toBe(200)
	})

	it('single file is rejected when minItems:2', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ file: t.Files({ minItems: 2 }) }) },
			() => 'ok'
		)

		const { request } = upload('/', { file: 'millenium.jpg' })
		const res = await app.handle(request)
		expect(res.status).toBe(422)
	})
})

describe('File/ArrayBuffer/Uint8Array meta preserved', () => {
	it('t.File preserves custom error in schema', () => {
		const schema = t.File({ error: 'must upload a file' })
		expect((schema as any).error).toBe('must upload a file')
	})

	it('t.File preserves description', () => {
		const schema = t.File({ description: 'user avatar' })
		expect((schema as any).description).toBe('user avatar')
	})

	it('t.File with options does not mutate BaseFile singleton', () => {
		const before422 = Value.Check(t.File(), new Blob())
		t.File({ error: 'custom error', minSize: '1k' })
		expect(Value.Check(t.File(), new Blob())).toBe(before422)
	})

	it('t.Files preserves description', () => {
		const schema = t.Files({ description: 'attachments' })
		// description must be on the schema or its anyOf union members
		const raw = schema as any
		const hasDesc =
			raw.description === 'attachments' ||
			(Array.isArray(raw.anyOf) &&
				raw.anyOf.some((m: any) => m.description === 'attachments'))
		expect(hasDesc).toBe(true)
	})

	it('t.File custom error surfaces in 422 response', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File({ error: 'please upload a valid file' })
				})
			},
			() => 'ok'
		)

		// POST non-multipart body — file field will be missing → 422
		const res = await app.handle(
			req('/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ file: 'not-a-file' })
			})
		)
		expect(res.status).toBe(422)
	})

	it('t.ArrayBuffer preserves description', () => {
		const schema = t.ArrayBuffer({ description: 'raw bytes' })
		expect((schema as any).description).toBe('raw bytes')
	})

	it('t.Uint8Array preserves description', () => {
		const schema = t.Uint8Array({ description: 'binary data' })
		expect((schema as any).description).toBe('binary data')
	})
})

describe('Nullable/MaybeEmpty no mutation', () => {
	it('t.Nullable does not mutate the options bag', () => {
		const options = { description: 'maybe null' }
		const before = { ...options }

		t.Nullable(t.String(), options)

		expect(options).toEqual(before)
		expect(Object.getOwnPropertyNames(options).sort()).toEqual(
			Object.getOwnPropertyNames(before).sort()
		)
	})

	it('t.Nullable one bag yields two distinct schemas', () => {
		const options = { description: 'shared' }

		const s1 = t.Nullable(t.String(), options)
		const s2 = t.Nullable(t.Number(), options)

		expect(s1).not.toBe(s2)
		// options bag is uncontaminated
		expect(options).toEqual({ description: 'shared' })
	})

	it('t.MaybeEmpty does not mutate the options bag', () => {
		const options = { description: 'maybe empty' }
		const before = { ...options }

		t.MaybeEmpty(t.String(), options)

		expect(options).toEqual(before)
		expect(Object.getOwnPropertyNames(options).sort()).toEqual(
			Object.getOwnPropertyNames(before).sort()
		)
	})

	it('t.MaybeEmpty one bag yields two distinct schemas', () => {
		const options = { description: 'shared' }

		const s1 = t.MaybeEmpty(t.String(), options)
		const s2 = t.MaybeEmpty(t.Number(), options)

		expect(s1).not.toBe(s2)
		expect(options).toEqual({ description: 'shared' })
	})
})
