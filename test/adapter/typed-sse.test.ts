import { describe, it, expect } from 'bun:test'
import { Elysia, sse } from '../../src'

const req = (path: string) => new Request(`http://localhost${path}`)

/**
 * Typed SSE lane: an `sse()`-marked generator/stream declares its intent,
 * so the adapter skips the eager first `.next()` sniffing pull and flushes
 * SSE headers immediately. Untyped generators keep the sniffing pull and
 * its pre-response error semantics — the lane split is the contract.
 */
describe('typed SSE (sse()-marked) no-eager-pull', () => {
	it('flushes headers before the first value resolves', async () => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => (release = resolve))

		const app = new Elysia().get('/', () =>
			sse(
				(async function* () {
					await gate
					yield sse({ data: 'late' })
				})()
			)
		)

		// If the eager pull were still present, handle() would not resolve
		// until `gate` does — the race would time out instead
		const response = await Promise.race([
			app.handle('/'),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error('headers were withheld')),
					500
				)
			)
		])

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('text/event-stream')

		release()
		await expect(response.text()).resolves.toContain('data: late')
	})

	it('does not set transfer-encoding on the typed lane', async () => {
		const app = new Elysia().get('/', () =>
			sse(
				(async function* () {
					yield sse({ data: 'a' })
				})()
			)
		)

		const response = await app.handle('/')

		expect(response.headers.get('transfer-encoding')).toBe(null)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(response.headers.get('cache-control')).toBe('no-cache')
		await expect(response.text()).resolves.toBe('data: a\n\n')
	})

	it('handles sse()-marked ReadableStream without transfer-encoding', async () => {
		const app = new Elysia().get('/', () =>
			sse(
				new ReadableStream<string>({
					start(controller) {
						controller.enqueue('hello')
						controller.close()
					}
				})
			)
		)

		const response = await app.handle('/')

		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(response.headers.get('transfer-encoding')).toBe(null)
		await expect(response.text()).resolves.toBe('data: hello\n\n')
	})

	it('surfaces an early throw as a mid-stream error, not a pre-response error', async () => {
		// Contract flip for the typed lane only: headers are already flushed,
		// so a generator throwing before its first yield errors the stream
		const app = new Elysia().get('/', () =>
			sse(
				// eslint-disable-next-line require-yield
				(async function* (): AsyncGenerator<unknown> {
					throw new Error('early failure')
				})()
			)
		)

		const response = await app.handle('/')

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('text/event-stream')

		await expect(response.body!.getReader().read()).rejects.toThrow(
			'early failure'
		)
	})

	it('keeps pre-response error semantics for untyped generators', async () => {
		// The other side of the lane split: an unwrapped generator still gets
		// the sniffing pull, so throwing before the first yield stays a
		// regular error response (#1677 semantics)
		const app = new Elysia().get('/', async function* () {
			if (true as boolean) throw new Error('early failure')
			yield 'unreachable'
		})

		const response = await app.handle('/')

		expect(response.status).toBe(500)
		expect(response.headers.get('content-type')).not.toBe(
			'text/event-stream'
		)
	})

	it('runs generator cleanup when the consumer cancels', async () => {
		let cleanedUp = false

		const app = new Elysia().get('/', () =>
			sse(
				(async function* () {
					try {
						let i = 0
						while (true) yield sse({ data: `${i++}` })
					} finally {
						cleanedUp = true
					}
				})()
			)
		)

		const response = await app.handle('/')
		const reader = response.body!.getReader()

		const first = await reader.read()
		expect(first.done).toBe(false)

		await reader.cancel()
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(cleanedUp).toBe(true)
	})

	it('does not run ahead of a stalled consumer (highWaterMark 0)', async () => {
		let produced = 0

		const app = new Elysia().get('/', () =>
			sse(
				(async function* () {
					for (let i = 0; i < 100; i++) {
						produced++
						yield sse({ data: `${i}` })
					}
				})()
			)
		)

		const response = await app.handle('/')
		const reader = response.body!.getReader()

		await reader.read()
		await new Promise((resolve) => setTimeout(resolve, 20))

		// With highWaterMark 0 the producer only advances on demand —
		// it must not free-run toward completion while the reader stalls
		expect(produced).toBeLessThanOrEqual(3)

		await reader.cancel()
	})
})
