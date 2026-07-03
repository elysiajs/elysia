import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

// M1 — Blob enqueue ordering: enqueueBinaryChunk returned a truthy Promise for
// Blobs; start()/pull() treated truthy as "done" and advanced without awaiting
// it, so pull() could be re-entered before the Blob bytes landed, reordering
// chunks or splitting them across the wrong delivery window.
describe('stream Blob ordering (M1)', () => {
	it('Blob bytes arrive before subsequent string chunk', async () => {
		const blobContent = 'hello from blob'
		const afterBlob = ' world'

		const app = new Elysia().get('/blob-then-string', async function* () {
			// M1: if start() returns without awaiting the Blob, pull() fires
			// before the blob bytes are enqueued, corrupting delivery order.
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
		// All bytes must be present and in order.
		expect(full).toBe(blobContent + afterBlob)
		// The Blob content must appear before the string suffix.
		// This specifically fails if pull() is re-entered before blob enqueue.
		expect(full.indexOf(blobContent)).toBeLessThan(
			full.indexOf(afterBlob)
		)
	})

	it('Blob as the first (init) chunk arrives complete and in order', async () => {
		// M1 also affects start() — the init value's Blob Promise was not returned
		// from start(), so the runtime called pull() immediately after start()
		// before the arrayBuffer() resolved.
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

// M9 — Mid-stream generator errors were swallowed: pull()'s catch did
// console.warn + controller.close(), so the client saw a clean EOF instead of
// a stream error. Downstream readers could not distinguish a successful end of
// data from a mid-flight failure.
describe('stream mid-stream error propagation (M9)', () => {
	it('reader observes a stream error when the generator throws mid-stream', async () => {
		const app = new Elysia().get('/error-mid', async function* () {
			yield 'first chunk'
			throw new Error('mid-stream failure')
		})

		const res = await app.handle(new Request('http://localhost/error-mid'))
		const reader = res.body!.getReader()

		// Consume the first chunk successfully.
		const first = await reader.read()
		expect(first.done).toBe(false)

		// The next read must reject (stream error), not resolve with done=true.
		// M9: before the fix this resolved {done:true} (clean close).
		// The specific error class (TypeError vs Error) is irrelevant to the invariant.
		await expect(reader.read()).rejects.toThrow()
	})
})
