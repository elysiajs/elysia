import { describe, expect, it } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Elysia, file } from '../../src'
import {
	mapCompactResponse,
	mapResponse
} from '../../src/adapter/web-standard/handler'
import { formDataToObject } from '../../src/adapter/web-standard/utils'

describe('multipart JSON sibling with files', () => {
	const json = JSON.stringify({ name: 'saltyaom' })
	const a = new File(['a'], 'a.txt')
	const b = new File(['b'], 'b.txt')

	const form = (...entries: (string | File)[]) => {
		const data = new FormData()
		for (const entry of entries) data.append('payload', entry)
		return formDataToObject(data).payload as Record<string, unknown>
	}

	// FormData copies each File, compare by name
	const names = (files: unknown) => (files as File[]).map((f) => f.name)

	// a JSON part sent next to its upload is one logical object: the file
	// must land inside it, or the handler loses either the metadata or the file
	it('attaches a single file as `file`', () => {
		const payload = form(json, a)

		expect(payload.name).toBe('saltyaom')
		expect((payload.file as File).name).toBe('a.txt')
		expect(payload.files).toBeUndefined()
	})

	it('attaches several files as `files` in order', () => {
		const payload = form(json, a, b)

		expect(payload.name).toBe('saltyaom')
		expect(names(payload.files)).toEqual(['a.txt', 'b.txt'])
		expect(payload.file).toBeUndefined()
	})

	// never overwrite a key the client sent itself
	it('falls back to `files` when the JSON already has `file`', () => {
		const payload = form(JSON.stringify({ file: 'keep' }), a)

		expect(payload.file).toBe('keep')
		expect(names(payload.files)).toEqual(['a.txt'])
	})
})

describe('file() content-type', () => {
	// An extension Elysia has no mime entry for must not clobber the
	// content-type the handler chose (nor force application/octet-stream)
	it('keeps the user content-type for an unknown extension', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'elysia-file-'))
		const path = join(dir, 'data.elysiaunknown')
		await writeFile(path, 'hi')

		const app = new Elysia().get('/', ({ set }) => {
			set.headers['content-type'] = 'application/x-custom'
			return file(path)
		})

		const response = await app.handle('/')

		expect(response.headers.get('content-type')).toBe(
			'application/x-custom'
		)
		expect(await response.text()).toBe('hi')
	})

	it('types a known extension', async () => {
		const app = new Elysia().get('/', () =>
			file('test/images/aris-yuzu.jpg')
		)

		expect((await app.handle('/')).headers.get('content-type')).toBe(
			'image/jpeg'
		)
	})
})

describe('Promise subclass response', () => {
	// e.g. an un-awaited Bun.sql `Query`: an unknown constructor name that
	// is still a thenable must be awaited, not stringified. Handlers await
	// it first, so map directly (mapResponse hooks, afterHandle values)
	class Query<T> extends Promise<T> {}

	it('awaits it on the compact lane', async () => {
		const response = await mapCompactResponse(Query.resolve('compact'))

		expect(await response.text()).toBe('compact')
	})

	it('awaits it on the set lane', async () => {
		const response = await mapResponse(Query.resolve({ lane: 'set' }), {
			headers: { 'x-lane': 'set' },
			status: 200
		} as any)

		expect(response.headers.get('x-lane')).toBe('set')
		expect(await response.json()).toEqual({ lane: 'set' })
	})
})
