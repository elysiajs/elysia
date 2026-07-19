import { describe, expect, it } from 'bun:test'
import { bytes, Elysia, sse } from '../../src'

const request = (path = '/') => new Request(`http://localhost${path}`)

const deferred = () => {
	let resolve!: () => void
	const promise = new Promise<void>((done) => (resolve = done))

	return { promise, resolve }
}

describe('typed stream lanes', () => {
	it('passes a certified byte stream through without re-pumping it', async () => {
		const payload = new Uint8Array([0, 1, 2, 253, 254, 255])
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(payload)
				controller.close()
			}
		})
		const app = new Elysia().get(
			'/',
			{
				afterHandle({ set }) {
					set.headers['x-settled'] = 'yes'
				}
			},
			() => bytes(source)
		)

		const response = await app.handle(request())

		expect(response.body).toBe(source)
		expect(response.headers.get('content-type')).toBe(
			'application/octet-stream'
		)
		expect(response.headers.get('x-settled')).toBe('yes')
		expect(response.headers.get('transfer-encoding')).toBeNull()
		expect(response.headers.get('connection')).toBeNull()
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload)
	})

	it('preserves native cancellation for a certified byte stream', async () => {
		let cancellations = 0
		const source = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array([1]))
			},
			cancel() {
				cancellations++
			}
		})
		const app = new Elysia().get('/', () => bytes(source))
		const response = await app.handle(request())
		const reader = response.body!.getReader()

		await reader.read()
		await reader.cancel()

		expect(cancellations).toBe(1)
	})

	it('returns typed SSE headers without awaiting the first yield', async () => {
		const gate = deferred()
		let entered = false
		let settled = false
		const source = sse(
			(async function* () {
				entered = true
				await gate.promise
				yield 'ready'
			})()
		)
		const app = new Elysia().get('/', () => source)
		const responsePromise = app.handle(request()).then((response) => {
			settled = true
			return response
		})

		await Bun.sleep(10)
		expect(settled).toBe(true)
		expect(entered).toBe(false)

		const response = await responsePromise
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(response.headers.get('cache-control')).toBe('no-cache')
		expect(response.headers.get('transfer-encoding')).toBeNull()
		expect(response.headers.get('connection')).toBeNull()

		const body = response.text()
		await Bun.sleep(0)
		expect(entered).toBe(true)
		gate.resolve()
		expect(await body).toBe('data: ready\n\n')
	})

	it('preserves typed SSE through afterResponse and trace teeing', async () => {
		const gate = deferred()
		let settled = false
		let afterResponse = 0
		const source = sse(
			(async function* () {
				await gate.promise
				yield 'ready'
			})()
		)
		const app = new Elysia()
			.afterResponse(() => {
				afterResponse++
			})
			.trace(() => {})
			.get('/', () => source)
		const responsePromise = app.handle(request()).then((response) => {
			settled = true
			return response
		})

		await Bun.sleep(10)
		expect(settled).toBe(true)

		const response = await responsePromise
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(response.headers.get('transfer-encoding')).toBeNull()
		expect(response.headers.get('connection')).toBeNull()

		gate.resolve()
		expect(await response.text()).toBe('data: ready\n\n')
		await Bun.sleep(0)
		expect(afterResponse).toBe(1)
	})

	it('preserves typed SSE through the synchronous afterResponse tee', async () => {
		const gate = deferred()
		let settled = false
		let afterResponse = 0
		const source = sse(
			(async function* () {
				await gate.promise
				yield 'ready'
			})()
		)
		const app = new Elysia()
			.afterResponse(() => {
				afterResponse++
			})
			.get('/', () => source)
		const responsePromise = app.handle(request()).then((response) => {
			settled = true
			return response
		})

		await Bun.sleep(10)
		expect(settled).toBe(true)

		const response = await responsePromise
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(response.headers.get('transfer-encoding')).toBeNull()
		expect(response.headers.get('connection')).toBeNull()

		gate.resolve()
		expect(await response.text()).toBe('data: ready\n\n')
		await Bun.sleep(0)
		expect(afterResponse).toBe(1)
	})

	it('keeps the eager first-yield behavior for unmarked generators', async () => {
		const gate = deferred()
		let settled = false
		const app = new Elysia().get('/', async function* () {
			await gate.promise
			yield 'ready'
		})
		const responsePromise = app.handle(request()).then((response) => {
			settled = true
			return response
		})

		await Bun.sleep(10)
		expect(settled).toBe(false)

		gate.resolve()
		const response = await responsePromise
		expect(await response.text()).toBe('ready')
	})

	it('calls iterator.return once across cancel and abort', async () => {
		const gate = deferred()
		let returnCalls = 0
		const source = (async function* () {
			yield 'first'
			await gate.promise
			yield 'second'
		})()
		const originalReturn = source.return.bind(source)
		source.return = ((value?: any) => {
			returnCalls++
			return originalReturn(value)
		}) as typeof source.return

		const abort = new AbortController()
		const app = new Elysia().get('/', () => sse(source))
		const response = await app.handle(
			new Request('http://localhost/', { signal: abort.signal })
		)
		const reader = response.body!.getReader()

		await reader.read()
		await reader.cancel()
		abort.abort()
		gate.resolve()
		await Bun.sleep(0)

		expect(returnCalls).toBe(1)
	})

	it('finalizes the iterator once when a typed SSE source errors', async () => {
		let returnCalls = 0
		const source = (async function* () {
			yield 'first'
			throw new Error('stream failed')
		})()
		const originalReturn = source.return.bind(source)
		source.return = ((value?: any) => {
			returnCalls++
			return originalReturn(value)
		}) as typeof source.return

		const app = new Elysia().get('/', () => sse(source))
		const response = await app.handle(request())
		const reader = response.body!.getReader()

		expect((await reader.read()).done).toBe(false)
		await expect(reader.read()).rejects.toThrow('stream failed')
		expect(returnCalls).toBe(1)
	})

	it('preserves undefined as a typed SSE source error', async () => {
		const source = sse(
			(async function* () {
				yield 'first'
				throw undefined
			})()
		)
		const app = new Elysia().get('/', () => source)
		const response = await app.handle(request())
		const reader = response.body!.getReader()

		expect((await reader.read()).done).toBe(false)

		let rejected = false
		let reason: unknown = Symbol('not rejected')
		try {
			await reader.read()
		} catch (error) {
			rejected = true
			reason = error
		}

		expect(rejected).toBe(true)
		expect(reason).toBeUndefined()
	})
})
