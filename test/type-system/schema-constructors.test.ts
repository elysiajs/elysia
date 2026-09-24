import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { upload } from '../utils'

describe('t.UnionEnum options', () => {
	it('prefers an explicit default over the first enum member', () => {
		const schema = t.UnionEnum(['a', 'b', 'c'], { default: 'c' })
		expect((schema as any).default).toBe('c')
	})

	it('uses the first enum member when no default is provided', () => {
		const schema = t.UnionEnum(['x', 'y'])
		expect((schema as any).default).toBe('x')
	})

	it('does not mutate the options object', () => {
		const options = { description: 'pick one' }
		const before = { ...options }

		t.UnionEnum(['a', 'b'], options)

		expect(options).toEqual(before)
		expect(Object.getOwnPropertyNames(options).sort()).toEqual(
			Object.getOwnPropertyNames(before).sort()
		)
	})

	it('builds independent schemas when the options object is reused', () => {
		const options = { description: 'shared' }

		const s1 = t.UnionEnum(['a', 'b'], options)
		const s2 = t.UnionEnum([1, 2], options)

		expect((s1 as any).enum).toEqual(['a', 'b'])
		expect((s2 as any).enum).toEqual([1, 2])
		expect((s1 as any).enum).toEqual(['a', 'b'])
		expect(s1).not.toBe(s2)
	})

	it('keeps request validation independent after options reuse', async () => {
		const schema = t.Object({ color: t.UnionEnum(['red', 'blue']) })

		const app = new Elysia().post(
			'/color',
			{ body: schema },
			({ body }) => body
		)

		const ok = await app.handle('/color', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ color: 'red' })
		})
		expect(ok.status).toBe(200)

		const bad = await app.handle('/color', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ color: 'green' })
		})
		expect(bad.status).toBe(422)
	})
})

describe('t.Files item limits after multipart decoding', () => {
	it('accepts one decoded file within minItems: 1 and maxItems: 3', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ file: t.Files({ minItems: 1, maxItems: 3 }) }) },
			() => 'ok'
		)

		const { request } = upload('/', { file: 'millenium.jpg' })
		const res = await app.handle(request)
		expect(res.status).toBe(200)
	})

	it('accepts two decoded files when minItems is 2', async () => {
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

	it('rejects one decoded file when minItems is 2', async () => {
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

describe('File and binary schema metadata', () => {
	it('t.File preserves a custom error', () => {
		const schema = t.File({ error: 'must upload a file' })
		expect((schema as any).error).toBe('must upload a file')
	})

	it('t.File preserves its description', () => {
		const schema = t.File({ description: 'user avatar' })
		expect((schema as any).description).toBe('user avatar')
	})

	it('t.File options do not alter the no-options schema', () => {
		const before422 = Value.Check(t.File(), new Blob())
		t.File({ error: 'custom error', minSize: '1k' })
		expect(Value.Check(t.File(), new Blob())).toBe(before422)
	})

	it('t.Files preserves its description', () => {
		const schema = t.Files({ description: 'attachments' })
		const raw = schema as any
		const hasDesc =
			raw.description === 'attachments' ||
			(Array.isArray(raw.anyOf) &&
				raw.anyOf.some((m: any) => m.description === 'attachments'))
		expect(hasDesc).toBe(true)
	})

	it('t.File returns its custom error in a 422 response', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File({ error: 'please upload a valid file' })
				})
			},
			() => 'ok'
		)

		const res = await app.handle('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ file: 'not-a-file' })
		})
		expect(res.status).toBe(422)
	})

	it('t.ArrayBuffer preserves its description', () => {
		const schema = t.ArrayBuffer({ description: 'raw bytes' })
		expect((schema as any).description).toBe('raw bytes')
	})

	it('t.Uint8Array preserves its description', () => {
		const schema = t.Uint8Array({ description: 'binary data' })
		expect((schema as any).description).toBe('binary data')
	})
})

describe('t.Nullable and t.MaybeEmpty options', () => {
	it('t.Nullable does not mutate the options object', () => {
		const options = { description: 'maybe null' }
		const before = { ...options }

		t.Nullable(t.String(), options)

		expect(options).toEqual(before)
		expect(Object.getOwnPropertyNames(options).sort()).toEqual(
			Object.getOwnPropertyNames(before).sort()
		)
	})

	it('t.Nullable builds independent schemas from reused options', () => {
		const options = { description: 'shared' }

		const s1 = t.Nullable(t.String(), options)
		const s2 = t.Nullable(t.Number(), options)

		expect(s1).not.toBe(s2)
		expect(options).toEqual({ description: 'shared' })
	})

	it('t.MaybeEmpty does not mutate the options object', () => {
		const options = { description: 'maybe empty' }
		const before = { ...options }

		t.MaybeEmpty(t.String(), options)

		expect(options).toEqual(before)
		expect(Object.getOwnPropertyNames(options).sort()).toEqual(
			Object.getOwnPropertyNames(before).sort()
		)
	})

	it('t.MaybeEmpty builds independent schemas from reused options', () => {
		const options = { description: 'shared' }

		const s1 = t.MaybeEmpty(t.String(), options)
		const s2 = t.MaybeEmpty(t.Number(), options)

		expect(s1).not.toBe(s2)
		expect(options).toEqual({ description: 'shared' })
	})
})
