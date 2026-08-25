import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

describe('stream chunk encoding', () => {
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
