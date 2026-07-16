import { describe, it, expect } from 'bun:test'
import { Elysia, t, sse } from '../../src'
import { ValidationError, status } from '../../src/error'
import { req } from '../utils'

// Runtime contracts that previously regressed across unrelated code paths.

describe('named empty state registrations', () => {
	it('keeps .state(name, {}) and .state(name, [])', async () => {
		const app = new Elysia()
			.state('list', [] as string[])
			.state('obj', {} as Record<string, string>)
			.get('/', ({ store }) => ({
				list: store.list,
				obj: store.obj,
				hasList: store.list !== undefined,
				hasObj: store.obj !== undefined
			}))

		// typed store properties must exist at runtime, otherwise typed-clean
		// code crashes on first property access
		await expect(
			app.handle(req('/')).then((r) => r.json())
		).resolves.toEqual({
			list: [],
			obj: {},
			hasList: true,
			hasObj: true
		})
	})
})

describe('.error(Error, handler) catch-all with class mapping', () => {
	it('routes bare Error through the class overload, not the scope overload', async () => {
		const app = new Elysia()
			.error(Error, ({ error }) => `caught: ${(error as Error).message}`)
			.get('/boom', () => {
				throw new Error('kaboom')
			})

		const res = await app.handle(req('/boom'))
		expect(await res.text()).toBe('caught: kaboom')
	})
})

describe('named empty statuses attach no body', () => {
	it("status('No Content') ≡ status(204)", async () => {
		const named = new Elysia().get('/named', () => status('No Content'))
		const numeric = new Elysia().get('/numeric', () => status(204))

		const namedRes = await named.handle(req('/named'))
		const numericRes = await numeric.handle(req('/numeric'))

		expect(namedRes.status).toBe(204)
		expect(numericRes.status).toBe(204)

		const namedBody = await namedRes.text()
		expect(namedBody).toBe(await numericRes.text())
		expect(namedBody).toBe('')
	})
})

describe('malformed-body 400 carries dev detail', () => {
	it('includes the parse cause message outside production', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ x: t.Number() }) },
			({ body }) => body
		)

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{invalid json'
			})
		)

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		// 500s already surface dev detail; 400 parse errors must too
		expect(typeof body.detail).toBe('string')
		expect(body.detail.length).toBeGreaterThan(0)
	})
})

describe('coercion-union 422 does not leak internals', () => {
	it('collapses the anyOf triple into one issue per field', async () => {
		const app = new Elysia().get(
			'/x',
			{ query: t.Object({ page: t.Number() }) },
			({ query }) => query
		)

		const res = await app.handle(req('/x?page=abc'))
		expect(res.status).toBe(422)

		const body = (await res.json()) as any
		expect(body.errors).toHaveLength(1)
		// no `~refine` keyword, no anyOf schemaPath may surface to users
		expect(JSON.stringify(body)).not.toContain('~refine')
		expect(JSON.stringify(body)).not.toContain('anyOf')
		expect(body.errors[0].message).toBe('must be number')
	})
})

describe('array query params split before percent-decoding', () => {
	const app = new Elysia().get(
		'/x',
		{ query: t.Object({ ids: t.Array(t.String()) }) },
		({ query }) => query.ids
	)
	const run = (q: string) => app.handle(req(`/x?${q}`)).then((r) => r.json())

	it('keeps %2C as a literal comma inside an element', async () => {
		// decode-before-split made a%2Cb indistinguishable from a,b
		await expect(run('ids=a%2Cb')).resolves.toEqual(['a,b'])
		await expect(run('ids=[a%2Cb]')).resolves.toEqual(['a,b'])
	})

	it('still splits raw commas and fully-encoded array literals', async () => {
		await expect(run('ids=a,b')).resolves.toEqual(['a', 'b'])
		await expect(run('ids=[a,b]')).resolves.toEqual(['a', 'b'])
		// the sender encoded the whole literal — commas are separators
		await expect(
			run('ids=' + encodeURIComponent('[a,b]'))
		).resolves.toEqual(['a', 'b'])
	})

	it('treats ids=[] as an explicit empty array, not [""]', async () => {
		await expect(run('ids=[]')).resolves.toEqual([])
	})
})

describe('streaming headers survive a multi-cookie response', () => {
	it('keeps content-type/cache-control when >1 cookie is set', async () => {
		// >1 cookie flips set.headers into a Headers instance; the streaming
		// defaults must not be written as dead JS properties on it
		const app = new Elysia().get('/stream', function* ({ cookie }) {
			cookie.a.value = '1'
			cookie.b.value = '2'
			yield sse('one')
			yield sse('two')
		})

		const res = await app.handle(req('/stream'))

		expect(res.headers.get('content-type')).toBe('text/event-stream')
		expect(res.headers.get('cache-control')).toBe('no-cache')
		expect(res.headers.getAll('set-cookie')).toHaveLength(2)
		expect(await res.text()).toBe('data: one\n\ndata: two\n\n')
	})
})

describe('lazy ValidationError keeps its lazy/enumerable contract', () => {
	it('does not run the thunk until read and memoizes across accessors', () => {
		let calls = 0
		const error = new ValidationError('body', { x: 1 }, () => {
			calls++
			return [{ instancePath: '/x', message: 'nope' }]
		})

		expect(calls).toBe(0)
		expect(error.message).toBe('nope')
		expect(error.errors).toHaveLength(1)
		expect(error.customError).toBeUndefined()
		expect(calls).toBe(1)
	})
})
