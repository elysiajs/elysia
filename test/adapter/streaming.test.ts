import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

// All text chunks (plain, JSON, SSE) must arrive as Uint8Array so the
// stream works on Node/Deno/CF Workers (Bun auto-encodes; others do not).
describe('stream chunks are Uint8Array', () => {
	it('plain string chunk is enqueued as Uint8Array', async () => {
		const app = new Elysia().get('/str', async function* () {
			yield 'hello'
			yield ' world'
		})

		const res = await app.handle(new Request('http://localhost/str'))
		const reader = res.body!.getReader()
		const chunks: unknown[] = []

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		expect(chunks.length).toBeGreaterThan(0)
		for (const chunk of chunks) expect(chunk).toBeInstanceOf(Uint8Array)

		const text = chunks
			.map((c) => new TextDecoder().decode(c as Uint8Array))
			.join('')
		expect(text).toBe('hello world')
	})

	it('JSON object chunk is enqueued as Uint8Array', async () => {
		const app = new Elysia().get('/json', async function* () {
			yield { a: 1 }
			yield { b: 2 }
		})

		const res = await app.handle(new Request('http://localhost/json'))
		const reader = res.body!.getReader()
		const chunks: unknown[] = []

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		expect(chunks.length).toBeGreaterThan(0)
		for (const chunk of chunks) expect(chunk).toBeInstanceOf(Uint8Array)
	})

	it('SSE toSSE chunk is enqueued as Uint8Array', async () => {
		const app = new Elysia().get('/sse', async function* () {
			yield { data: 'msg1', sse: true, toSSE: () => 'data: msg1\n\n' }
			yield { data: 'msg2', sse: true, toSSE: () => 'data: msg2\n\n' }
		})

		const res = await app.handle(new Request('http://localhost/sse'))
		const reader = res.body!.getReader()
		const chunks: unknown[] = []

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		expect(chunks.length).toBeGreaterThan(0)
		for (const chunk of chunks) expect(chunk).toBeInstanceOf(Uint8Array)

		const text = chunks
			.map((c) => new TextDecoder().decode(c as Uint8Array))
			.join('')
		expect(text).toContain('data: msg1')
		expect(text).toContain('data: msg2')
	})

	it('init (first) chunk is enqueued as Uint8Array', async () => {
		const app = new Elysia().get('/init', async function* () {
			yield 'first'
			yield 'second'
		})

		const res = await app.handle(new Request('http://localhost/init'))
		const reader = res.body!.getReader()
		const { value: first } = await reader.read()

		expect(first).toBeInstanceOf(Uint8Array)
		expect(new TextDecoder().decode(first)).toBe('first')

		await reader.cancel()
	})

	it('binary (Uint8Array) chunk is still passed through correctly', async () => {
		const app = new Elysia().get('/bin', async function* () {
			yield new Uint8Array([1, 2, 3])
			yield new Uint8Array([4, 5, 6])
		})

		const res = await app.handle(new Request('http://localhost/bin'))
		const reader = res.body!.getReader()
		const chunks: Uint8Array[] = []

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value as Uint8Array)
		}

		expect(chunks.length).toBeGreaterThan(0)
		for (const chunk of chunks) expect(chunk).toBeInstanceOf(Uint8Array)

		const combined = [...chunks[0], ...chunks[1]]
		expect(combined).toEqual([1, 2, 3, 4, 5, 6])
	})
})

// handleSet copy-on-write — the flatten must be skipped when a request
// never mutated set.headers, but default headers must still appear.
// The critical invariant: first request's mutations must NOT bleed into second.
describe('handleSet copy-on-write default headers', () => {
	it('default headers appear on response when request does not mutate them', async () => {
		const app = new Elysia()
			.headers({ 'x-powered-by': 'elysia' })
			.get('/plain', () => 'ok')

		const res = await app.handle(new Request('http://localhost/plain'))
		expect(res.headers.get('x-powered-by')).toBe('elysia')
	})

	it('first request mutation does not bleed into second request', async () => {
		const app = new Elysia()
			.headers({ 'x-default': 'default-value' })
			.get('/mutate', ({ set }) => {
				set.headers['x-custom'] = 'custom-value'
				return 'ok'
			})

		// First request — mutates headers
		const res1 = await app.handle(new Request('http://localhost/mutate'))
		expect(res1.headers.get('x-default')).toBe('default-value')
		expect(res1.headers.get('x-custom')).toBe('custom-value')

		// Second request — must NOT see x-custom from first request
		const res2 = await app.handle(new Request('http://localhost/mutate'))
		expect(res2.headers.get('x-default')).toBe('default-value')
		expect(res2.headers.get('x-custom')).toBe('custom-value') // set by handler again

		// Sanity: a route that does NOT mutate headers never exposes request-only keys
		const app2 = new Elysia()
			.headers({ 'x-default': 'default-value' })
			.get('/read', () => 'ok')
			.get('/mutate', ({ set }) => {
				set.headers['x-only-on-mutate'] = 'yes'
				return 'mutated'
			})

		await app2.handle(new Request('http://localhost/mutate'))

		const res3 = await app2.handle(new Request('http://localhost/read'))
		// The /read route must not have x-only-on-mutate from the prior /mutate request
		expect(res3.headers.get('x-only-on-mutate')).toBeNull()
	})

	it('unmutated request still gets default headers (fast path)', async () => {
		const app = new Elysia()
			.headers({ 'x-app': 'test', 'x-version': '1' })
			.get('/fast', () => 'hello')

		// multiple requests — all should see default headers via fast path
		for (let i = 0; i < 3; i++) {
			const res = await app.handle(new Request('http://localhost/fast'))
			expect(res.headers.get('x-app')).toBe('test')
			expect(res.headers.get('x-version')).toBe('1')
		}
	})
})
