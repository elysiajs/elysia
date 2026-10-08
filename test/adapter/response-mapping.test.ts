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

describe('iterator-like object response', () => {
	// A hand-written iterator (callable `next`, no Symbol.asyncIterator) is
	// a stream, not data: the compact lane (route never touches `set`) must
	// stream it exactly like the set lane does instead of serializing `{}`
	const iterator = (onReturn?: () => void) => {
		let i = 0

		return {
			next: () =>
				i++ < 2
					? { value: `c${i}`, done: false }
					: { value: undefined, done: true },
			return() {
				onReturn?.()

				return { value: undefined, done: true }
			}
		}
	}

	const app = new Elysia()
		.get('/compact', () => iterator())
		.get('/set', ({ set }) => {
			set.headers['x-lane'] = 'set'

			return iterator()
		})
		.get('/not-iterator', () => ({ next: 'not callable' }))
		.get('/object', () => ({ name: 'Shiroko', id: 1 }))

	it('streams it on the compact lane like the set lane', async () => {
		const compact = await app.handle(
			new Request('http://localhost/compact')
		)
		const set = await app.handle(new Request('http://localhost/set'))

		expect(compact.headers.get('content-type')).toBe(
			set.headers.get('content-type')
		)
		expect(await compact.text()).toBe('c1c2')
		expect(await set.text()).toBe('c1c2')

		const direct = await mapCompactResponse(iterator())
		expect(await direct.text()).toBe('c1c2')
	})

	it('returns the iterator when the compact stream is cancelled', async () => {
		let returned = 0
		const response = await mapCompactResponse(iterator(() => returned++))

		await response.body!.cancel()

		expect(returned).toBe(1)
	})

	it('serializes an object whose `next` is not callable as JSON', async () => {
		const response = await app.handle(
			new Request('http://localhost/not-iterator')
		)

		expect(response.headers.get('content-type')).toStartWith(
			'application/json'
		)
		expect(await response.text()).toBe('{"next":"not callable"}')
	})

	// a custom async iterator may answer `next()` with any thenable; later
	// pulls already await one, but the first was awaited only when it was a
	// native Promise, so the thenable itself was taken as the result: no
	// `done`, no chunks, an empty body
	const thenables = (first: (result: unknown) => unknown) => {
		let i = 0
		const step = () =>
			i++ < 2
				? { value: `c${i}`, done: false }
				: { value: undefined, done: true }

		return {
			next: () =>
				i === 0
					? first(step())
					: { then: (resolve: Function) => resolve(step()) }
		}
	}

	it('awaits a foreign thenable from the first next()', async () => {
		const app = new Elysia()
			.get('/compact', () =>
				thenables((result) => ({
					then: (resolve: Function) => resolve(result)
				}))
			)
			.get('/set', ({ set }) => {
				set.headers['x-lane'] = 'set'

				return thenables((result) => ({
					then: (resolve: Function) => resolve(result)
				}))
			})

		for (const path of ['/compact', '/set'])
			expect(
				await app
					.handle(new Request(`http://localhost${path}`))
					.then((x) => x.text())
			).toBe('c1c2')
	})

	it('awaits a native Promise whose own `then` is shadowed', async () => {
		// native first: an own non-callable `then` must not demote a real
		// Promise to a plain result
		const app = new Elysia().get('/', () =>
			thenables((result) =>
				Object.assign(Promise.resolve(result), { then: 'shadowed' })
			)
		)

		expect(
			await app
				.handle(new Request('http://localhost/'))
				.then((x) => x.text())
		).toBe('c1c2')
	})

	it('keeps a plain object JSON response byte-identical', async () => {
		const response = await app.handle(
			new Request('http://localhost/object')
		)

		expect(response.headers.get('content-type')).toBe(
			'application/json;charset=utf-8'
		)
		expect(await response.text()).toBe('{"name":"Shiroko","id":1}')
	})
})
