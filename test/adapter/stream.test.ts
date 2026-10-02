import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

const trackedSignal = () => {
	const controller = new AbortController()
	const signal = controller.signal as AbortSignal & {
		addEventListener: AbortSignal['addEventListener']
		removeEventListener: AbortSignal['removeEventListener']
	}
	const addEventListener = signal.addEventListener.bind(signal)
	const removeEventListener = signal.removeEventListener.bind(signal)
	let added = 0
	let removed = 0

	signal.addEventListener = ((type, listener, options) => {
		if (type === 'abort') added++
		return addEventListener(type, listener, options)
	}) as AbortSignal['addEventListener']
	signal.removeEventListener = ((type, listener, options) => {
		if (type === 'abort') removed++
		return removeEventListener(type, listener, options)
	}) as AbortSignal['removeEventListener']

	return { signal, counts: () => [added, removed] }
}

const unencodableChunk = (error: Error) => ({
	toJSON() {
		throw error
	},
	toString() {
		throw error
	}
})

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

describe('stream terminal ownership', () => {
	it('finalizes after the first chunk cannot be encoded', async () => {
		const error = new Error('first chunk encoding failed')
		let finalized = 0
		const cleanup = Promise.withResolvers<void>()
		const { signal, counts } = trackedSignal()
		const app = new Elysia().get('/', async function* () {
			try {
				yield unencodableChunk(error)
			} finally {
				finalized++
				cleanup.resolve()
				throw new Error('secondary finalizer failure')
			}
		})

		const response = await app.handle('/', { signal })
		const observed = await response.text().then(
			() => undefined,
			(error) => error
		)
		await cleanup.promise

		expect(observed).toBe(error)
		expect(finalized).toBe(1)
		expect(counts()).toEqual([1, 1])
	})

	it('finalizes after a later chunk cannot be encoded', async () => {
		const error = new Error('later chunk encoding failed')
		let finalized = 0
		const cleanup = Promise.withResolvers<void>()
		const { signal, counts } = trackedSignal()
		const app = new Elysia().get('/', async function* () {
			try {
				yield 'first'
				yield unencodableChunk(error)
			} finally {
				finalized++
				cleanup.resolve()
				throw new Error('secondary finalizer failure')
			}
		})

		const response = await app.handle('/', { signal })
		const observed = await response.text().then(
			() => undefined,
			(error) => error
		)
		await cleanup.promise

		expect(observed).toBe(error)
		expect(finalized).toBe(1)
		expect(counts()).toEqual([1, 1])
	})

	it('keeps a locked stream failure on the response body', async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue('inner')
			}
		})
		const lock = stream.getReader()
		const { signal, counts } = trackedSignal()

		try {
			const response = await new Elysia()
				.get('/', () => stream)
				.handle('/', { signal })

			expect(response.status).toBe(200)
			await expect(response.text()).rejects.toThrow(
				'ReadableStream is locked'
			)
			expect(counts()).toEqual([1, 1])
		} finally {
			await lock.cancel()
			lock.releaseLock()
		}
	})

	it('finalizes a generator that yields a locked stream', async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue('inner')
			}
		})
		const lock = stream.getReader()
		let finalized = 0
		const cleanup = Promise.withResolvers<void>()
		const { signal, counts } = trackedSignal()
		const app = new Elysia().get('/', async function* () {
			try {
				yield stream
			} finally {
				finalized++
				cleanup.resolve()
			}
		})

		try {
			const response = await app.handle('/', { signal })

			expect(response.status).toBe(200)
			await expect(response.text()).rejects.toThrow(
				'ReadableStream is locked'
			)
			await Promise.race([
				cleanup.promise,
				Bun.sleep(500).then(() => {
					throw new Error('stream finalization timed out')
				})
			])

			expect(finalized).toBe(1)
			expect(counts()).toEqual([1, 1])
		} finally {
			await lock.cancel()
			lock.releaseLock()
		}
	})

	it('finalizes a generator after its yielded stream completes', async () => {
		const events: string[] = []
		const finalized = Promise.withResolvers<void>()
		const app = new Elysia().get('/', async function* () {
			try {
				yield new ReadableStream({
					start(controller) {
						controller.enqueue('inner')
						controller.close()
						events.push('inner completed')
					}
				})
			} finally {
				events.push('outer finalized')
				finalized.resolve()
			}
		})

		const response = await app.handle('/')

		await expect(response.text()).resolves.toBe('inner')
		await finalized.promise
		expect(events).toEqual(['inner completed', 'outer finalized'])
	})

	it('finalizes a generator after its yielded stream is canceled', async () => {
		const events: string[] = []
		const finalized = Promise.withResolvers<void>()
		const app = new Elysia().get('/', async function* () {
			try {
				yield new ReadableStream({
					start(controller) {
						controller.enqueue('inner')
					},
					cancel() {
						events.push('inner canceled')
					}
				})
			} finally {
				events.push('outer finalized')
				finalized.resolve()
			}
		})

		const response = await app.handle('/')
		const reader = response.body!.getReader()
		await reader.read()
		await reader.cancel()
		await finalized.promise

		expect(events).toEqual(['inner canceled', 'outer finalized'])
	})

	it('finalizes a yielded stream before its generator on request abort', async () => {
		const events: string[] = []
		const request = new AbortController()
		const finalized = Promise.withResolvers<void>()
		const app = new Elysia().get('/', async function* () {
			try {
				yield new ReadableStream({
					start(controller) {
						controller.enqueue('inner')
					},
					pull() {
						return new Promise(() => {})
					},
					cancel() {
						events.push('inner canceled')
					}
				})
			} finally {
				events.push('outer finalized')
				finalized.resolve()
			}
		})

		const response = await app.handle('/', { signal: request.signal })
		const reader = response.body!.getReader()
		await reader.read()
		await Promise.resolve()
		request.abort()
		await Promise.race([
			finalized.promise,
			Bun.sleep(500).then(() => {
				throw new Error('stream finalization timed out')
			})
		])

		expect(events).toEqual(['inner canceled', 'outer finalized'])
		expect((await reader.read()).done).toBe(true)
	})

	it('finalizes a generator after its yielded stream errors', async () => {
		const error = new Error('inner stream failed')
		const events: string[] = []
		const finalized = Promise.withResolvers<void>()
		const app = new Elysia().get('/', async function* () {
			try {
				yield new ReadableStream({
					start(controller) {
						controller.enqueue('inner')
					},
					pull(controller) {
						controller.error(error)
						events.push('inner errored')
					}
				})
			} finally {
				events.push('outer finalized')
				finalized.resolve()
			}
		})

		const response = await app.handle('/')
		const reader = response.body!.getReader()
		await reader.read()
		const observed = await reader.read().then(
			() => undefined,
			(error) => error
		)
		await finalized.promise

		expect(observed).toBe(error)
		expect(events).toEqual(['inner errored', 'outer finalized'])
	})

	it('finalizes an ordinary generator once when canceled', async () => {
		let finalized = 0
		const cleanup = Promise.withResolvers<void>()
		const app = new Elysia().get('/', async function* () {
			try {
				yield 'first'
				yield 'never'
			} finally {
				finalized++
				cleanup.resolve()
			}
		})

		const response = await app.handle('/')
		const reader = response.body!.getReader()
		await reader.read()
		await reader.cancel()
		await cleanup.promise

		expect(finalized).toBe(1)
	})

	it('does not block cancellation on an in-flight generator pull', async () => {
		let finalized = 0
		const pullStarted = Promise.withResolvers<void>()
		const releasePull = Promise.withResolvers<void>()
		const cleanup = Promise.withResolvers<void>()
		const app = new Elysia().get('/', async function* () {
			try {
				yield 'first'
				pullStarted.resolve()
				await releasePull.promise
				yield 'never'
			} finally {
				finalized++
				cleanup.resolve()
			}
		})

		const response = await app.handle('/')
		const reader = response.body!.getReader()
		await reader.read()
		await pullStarted.promise

		const canceled = await Promise.race([
			reader.cancel().then(() => true),
			Bun.sleep(500).then(() => false)
		])
		expect(canceled).toBe(true)
		expect(finalized).toBe(0)

		releasePull.resolve()
		await cleanup.promise
		expect(finalized).toBe(1)
	})
})
