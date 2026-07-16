import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

describe('stream Blob ordering', () => {
	it('Blob bytes arrive before subsequent string chunk', async () => {
		const blobContent = 'hello from blob'
		const afterBlob = ' world'

		const app = new Elysia().get('/blob-then-string', async function* () {
			yield new Blob([blobContent])
			yield afterBlob
		})

		const res = await app.handle(
			new Request('http://localhost/blob-then-string')
		)

		const reader = res.body!.getReader()
		const chunks: string[] = []

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value instanceof Uint8Array)
				chunks.push(new TextDecoder().decode(value))
			else chunks.push(String(value))
		}

		const full = chunks.join('')
		expect(full).toBe(blobContent + afterBlob)
		expect(full.indexOf(blobContent)).toBeLessThan(full.indexOf(afterBlob))
	})

	it('Blob as the first chunk arrives complete and in order', async () => {
		const blobText = 'blob-init-chunk'
		const app = new Elysia().get('/blob-init', async function* () {
			yield new Blob([blobText])
			yield 'after'
		})

		const res = await app.handle(new Request('http://localhost/blob-init'))
		const text = await res.text()

		expect(text).toBe(blobText + 'after')
	})
})

describe('stream mid-stream error propagation', () => {
	it('reader observes a stream error when the generator throws mid-stream', async () => {
		const app = new Elysia().get('/error-mid', async function* () {
			yield 'first chunk'
			throw new Error('mid-stream failure')
		})

		const res = await app.handle(new Request('http://localhost/error-mid'))
		const reader = res.body!.getReader()

		const first = await reader.read()
		expect(first.done).toBe(false)

		await expect(reader.read()).rejects.toThrow()
	})
})
