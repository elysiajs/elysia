import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

import { Elysia, sse } from '../../src'
import { streamResponse } from '../../src/adapter/utils'
import { requestId } from '../../src/utils'

describe('Stream', () => {
	it('handle stream', async () => {
		const expected = ['a', 'b', 'c']

		const app = new Elysia().get('/', async function* () {
			yield 'a'
			await Bun.sleep(10)

			yield 'b'
			await Bun.sleep(10)

			yield 'c'
		})

		const response = await app
			.handle(req('/'))
			.then((x) => x.body)
			.then((x) => {
				if (!x) return

				const reader = x?.getReader()

				let acc = ''
				const { promise, resolve } = Promise.withResolvers()

				reader.read().then(function pump({ done, value }): unknown {
					if (done) return resolve(acc)

					expect(value.toString()).toBe(expected.shift()!)

					acc += value.toString()
					return reader.read().then(pump)
				})

				return promise
			})

		expect(expected).toHaveLength(0)
		expect(response).toBe('abc')
	})

	it('stop stream on canceled request', async () => {
		const expected = ['a', 'b']

		const app = new Elysia().get('/', async function* () {
			yield 'a'
			await Bun.sleep(10)

			yield 'b'
			await Bun.sleep(10)

			yield 'c'
		})

		const controller = new AbortController()

		setTimeout(() => {
			controller.abort()
		}, 15)

		const response = await app
			.handle(
				new Request('http://e.ly', {
					signal: controller.signal
				})
			)
			.then((x) => x.body)
			.then((x) => {
				if (!x) return

				const reader = x?.getReader()

				let acc = ''
				const { promise, resolve } = Promise.withResolvers()

				reader.read().then(function pump({ done, value }): unknown {
					if (done) return resolve(acc)

					expect(value.toString()).toBe(expected.shift()!)

					acc += value.toString()
					return reader.read().then(pump)
				})

				return promise
			})

		expect(expected).toHaveLength(0)
		expect(response).toBe('ab')
	})

	// `streamResponse` re-streams a Response body (chunked, unknown length). It
	// now uses `yield* body` instead of a manual getReader()/releaseLock() loop;
	// these pin the mid-stream abort semantics of that change.
	it('streamResponse cancels the source body on a mid-stream abort', async () => {
		let cancelled = false
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1]))
				controller.enqueue(new Uint8Array([2]))
				// left open on purpose — only an abort should end it
			},
			cancel() {
				cancelled = true
			}
		})

		const gen = streamResponse(new Response(body))

		const first = await gen.next()
		expect(first.done).toBe(false)
		expect([...(first.value as Uint8Array)]).toEqual([1])

		// consumer bails out before the stream ends (client disconnect)
		await gen.return(undefined as any)

		// `yield* body` forwards .return() to the body's async iterator, which
		// cancels the upstream — the old getReader()+releaseLock() did not.
		expect(cancelled).toBe(true)
	})

	it('streamResponse settles a mid-stream abort without hanging', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1]))
				controller.enqueue(new Uint8Array([2]))
				controller.enqueue(new Uint8Array([3]))
			}
		})

		const gen = streamResponse(new Response(body))
		await gen.next()

		const outcome = await Promise.race([
			gen.return(undefined as any).then(() => 'returned'),
			new Promise((resolve) => setTimeout(() => resolve('hung'), 500))
		])

		expect(outcome).toBe('returned')
	})

	it('streamResponse yields every chunk on normal completion', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1]))
				controller.enqueue(new Uint8Array([2]))
				controller.close()
			}
		})

		const out: number[] = []
		for await (const chunk of streamResponse(new Response(body)))
			out.push(...(chunk as Uint8Array))

		expect(out).toEqual([1, 2])
	})

	it('include multiple set-cookie headers in streamed response', async () => {
		const app = new Elysia().get('/', async function* (context) {
			context.cookie['cookie1'].set({
				value: 'value1'
			})
			context.cookie['cookie2'].set({
				value: 'value2'
			})

			yield sse({ event: 'test', data: { count: 1 } })
			yield sse({ event: 'test', data: { count: 2 } })
		})

		const response = await app.handle(req('/'))

		const cookieHeaders = response.headers.getSetCookie()
		expect(cookieHeaders).toHaveLength(2)
		expect(cookieHeaders.some((h) => h.includes('cookie1=value1'))).toBe(
			true
		)
		expect(cookieHeaders.some((h) => h.includes('cookie2=value2'))).toBe(
			true
		)
	})

	it('mutate set before yield is called', async () => {
		const expected = ['a', 'b', 'c']

		const app = new Elysia().get('/', function* ({ set }) {
			set.headers['access-control-allow-origin'] = 'http://saltyaom.com'

			yield 'a'
			yield 'b'
			yield 'c'
		})

		const response = await app.handle(req('/')).then((x) => x.headers)

		expect(response.get('access-control-allow-origin')).toBe(
			'http://saltyaom.com'
		)
	})

	it('mutate set before yield is called', async () => {
		const expected = ['a', 'b', 'c']

		const app = new Elysia().get('/', function* ({ set }) {
			set.headers['access-control-allow-origin'] = 'http://saltyaom.com'

			yield 'a'
			yield 'b'
			yield 'c'
		})

		const response = await app.handle(req('/')).then((x) => x.headers)

		expect(response.get('access-control-allow-origin')).toBe(
			'http://saltyaom.com'
		)
	})

	it('async mutate set before yield is called', async () => {
		const expected = ['a', 'b', 'c']

		const app = new Elysia().get('/', async function* ({ set }) {
			set.headers['access-control-allow-origin'] = 'http://saltyaom.com'

			yield 'a'
			yield 'b'
			yield 'c'
		})

		const response = await app.handle(req('/')).then((x) => x.headers)

		expect(response.get('access-control-allow-origin')).toBe(
			'http://saltyaom.com'
		)
	})

	// A generator handler ALWAYS streams, even when it returns a value without
	// yielding — the returned value becomes the single chunk. It must never fall
	// back to a buffered (non-stream) response.
	it('return value if not yield still streams', async () => {
		const app = new Elysia()
			.get('/', function* ({ set }) {
				return 'hello'
			})
			.get('/json', function* ({ set }) {
				return { hello: 'world' }
			})

		const response = await Promise.all([
			app.handle(req('/')),
			app.handle(req('/json'))
		])

		// the response is a chunked stream, not a buffered body
		expect(response[0].headers.get('transfer-encoding')).toBe('chunked')
		expect(response[0].body).toBeInstanceOf(ReadableStream)
		expect(response[1].headers.get('transfer-encoding')).toBe('chunked')

		await expect(response[0].text()).resolves.toBe('hello')
		await expect(response[1].json()).resolves.toEqual({
			hello: 'world'
		})
	})

	it('return async value if not yield still streams', async () => {
		const app = new Elysia()
			.get('/', async function* ({ set }) {
				return 'hello'
			})
			.get('/json', async function* ({ set }) {
				return { hello: 'world' }
			})

		const response = await Promise.all([
			app.handle(req('/')),
			app.handle(req('/json'))
		])

		expect(response[0].headers.get('transfer-encoding')).toBe('chunked')
		expect(response[0].body).toBeInstanceOf(ReadableStream)

		await expect(response[0].text()).resolves.toBe('hello')
		await expect(response[1].json()).resolves.toEqual({
			hello: 'world'
		})
	})

	it('handle object and array', async () => {
		const expected = [{ a: 'b' }, ['a'], ['a', 1, { a: 'b' }]]
		const expectedResponse = JSON.stringify([...expected])
		let i = 0

		const app = new Elysia().get('/', async function* () {
			yield expected[0]
			await Bun.sleep(10)

			yield expected[1]
			await Bun.sleep(10)

			yield expected[2]
		})

		app.handle(req('/'))
			.then((x) => x.body)
			.then((x) => {
				if (!x) return

				const reader = x?.getReader()

				const { promise, resolve } = Promise.withResolvers()

				reader.read().then(function pump({ done, value }): unknown {
					if (done) return resolve()

					expect(value.toString()).toBe(JSON.stringify(expected[i++]))

					return reader.read().then(pump)
				})

				return promise
			})
	})

	it('proxy fetch stream', async () => {
		const expected = ['a', 'b', 'c']
		let i = 0

		const app = new Elysia().get('/', async function* () {
			yield 'a'
			await Bun.sleep(10)
			yield 'b'
			await Bun.sleep(10)
			yield 'c'
		})

		const proxy = new Elysia().get('/', () =>
			app.handle(new Request('http://e.ly'))
		)

		proxy
			.handle(req('/'))
			.then((x) => x.body)
			.then((x) => {
				if (!x) return

				const reader = x?.getReader()

				const { promise, resolve } = Promise.withResolvers()

				reader.read().then(function pump({ done, value }): unknown {
					if (done) return resolve()

					expect(value.toString()).toBe(expected[i++])

					return reader.read().then(pump)
				})

				return promise
			})
	})

	it('handle sse with id', () => {
		const app = new Elysia().get('/sse', async function* () {
			for (let i = 0; i < 3; i++) {
				yield sse({
					id: requestId(),
					data: `message ${i}`
				})
				await Bun.sleep(10)
			}
		})

		return app
			.handle(req('/sse'))
			.then((x) => x.body)
			.then((x) => {
				if (!x) return

				const reader = x?.getReader()

				let acc = ''
				const { promise, resolve } = Promise.withResolvers()

				reader.read().then(function pump({ done, value }): unknown {
					if (done) return resolve(acc)

					acc += value.toString()
					return reader.read().then(pump)
				})

				return promise
			})
			.then((response) => {
				if (typeof response !== 'string')
					return void expect(response).toBeTypeOf('string')

				response
					.split('\n\n')
					.filter(Boolean)
					.forEach((x, i) => {
						expect(x).toInclude(`data: message ${i}`)
						expect(x).toInclude('id: ')
					})
			})
	})

	it('handle sse with event, retry and custom id', () => {
		const app = new Elysia().get('/sse', async function* () {
			for (let i = 0; i < 3; i++) {
				yield sse({
					data: `message ${i}`,
					event: 'message',
					retry: 1000,
					id: i
				})
				await Bun.sleep(10)
			}
		})

		return app
			.handle(req('/sse'))
			.then((x) => x.body)
			.then((x) => {
				if (!x) return

				const reader = x?.getReader()

				let acc = ''
				const { promise, resolve } = Promise.withResolvers()

				reader.read().then(function pump({ done, value }): unknown {
					if (done) return resolve(acc)

					acc += value.toString()
					return reader.read().then(pump)
				})

				return promise
			})
			.then((response) => {
				if (typeof response !== 'string')
					return void expect(response).toBeTypeOf('string')

				response
					.split('\n\n')
					.filter(Boolean)
					.forEach((x, i) => {
						expect(x).toInclude(`data: message ${i}`)
						expect(x).toInclude('event: message')
						expect(x).toInclude('retry: 1000')
						expect(x).toInclude(`id: ${i}`)
					})
			})
	})

	it('handle sse without id', () => {
		const app = new Elysia().get('/sse', async function* () {
			for (let i = 0; i < 3; i++) {
				yield sse({
					id: null,
					data: `message ${i}`
				})
				await Bun.sleep(10)
			}
		})

		return app
			.handle(req('/sse'))
			.then((x) => x.body)
			.then((x) => {
				if (!x) return

				const reader = x?.getReader()

				let acc = ''
				const { promise, resolve } = Promise.withResolvers()

				reader.read().then(function pump({ done, value }): unknown {
					if (done) return resolve(acc)

					acc += value.toString()
					return reader.read().then(pump)
				})

				return promise
			})
			.then((response) => {
				expect(response).toBe(
					'data: message 0\n\ndata: message 1\n\ndata: message 2\n\n'
				)
			})
	})

	it('handle sse short-form', () => {
		const app = new Elysia().get('/sse', async function* () {
			for (let i = 0; i < 3; i++) {
				yield sse(`message ${i}`)
				await Bun.sleep(10)
			}
		})

		return app
			.handle(req('/sse'))
			.then((x) => x.body)
			.then((x) => {
				if (!x) return

				const reader = x?.getReader()

				let acc = ''
				const { promise, resolve } = Promise.withResolvers()

				reader.read().then(function pump({ done, value }): unknown {
					if (done) return resolve(acc)

					acc += value.toString()
					return reader.read().then(pump)
				})

				return promise
			})
			.then((response) => {
				if (typeof response !== 'string')
					return void expect(response).toBeTypeOf('string')

				response
					.split('\n\n')
					.filter(Boolean)
					.forEach((x, i) => {
						expect(x).toInclude(`data: message ${i}`)
					})
			})
	})

	it('stream ReadableStream', async () => {
		const app = new Elysia().get('/', function () {
			return new ReadableStream({
				async start(controller) {
					controller.enqueue('Elysia')
					await Bun.sleep(1)

					controller.enqueue('Eden')
					await Bun.sleep(1)

					controller.close()
				}
			})
		})

		const response = await app.handle(req('/'))

		const result = []

		for await (const a of streamResponse(response)) result.push(a)

		expect(result).toEqual(['Elysia', 'Eden'])
	})

	it('stream ReadableStream return from generator function', async () => {
		const app = new Elysia().get('/', function* () {
			return new ReadableStream({
				async start(controller) {
					controller.enqueue('Elysia')
					await Bun.sleep(1)

					controller.enqueue('Eden')
					await Bun.sleep(1)

					controller.close()
				}
			})
		})

		const response = await app.handle(req('/'))

		const result = []

		for await (const a of streamResponse(response)) result.push(a)

		expect(result).toEqual(['Elysia', 'Eden'])
	})

	it('stream ReadableStream return from async generator function', async () => {
		const app = new Elysia().get('/', async function* () {
			return new ReadableStream({
				async start(controller) {
					controller.enqueue('Elysia')
					await Bun.sleep(1)

					controller.enqueue('Eden')
					await Bun.sleep(1)

					controller.close()
				}
			})
		})

		const response = await app.handle(req('/'))

		const result = []

		for await (const a of streamResponse(response)) result.push(a)

		expect(result).toEqual(['Elysia', 'Eden'])
	})

	it('stream ReadableStream with sse', async () => {
		const app = new Elysia().get('/', async function* () {
			return sse(
				new ReadableStream({
					async start(controller) {
						controller.enqueue('Elysia')
						await Bun.sleep(1)

						controller.enqueue('Eden')
						await Bun.sleep(1)

						controller.close()
					}
				})
			)
		})

		const response = await app.handle(req('/'))

		const result = []

		for await (const a of streamResponse(response)) result.push(a)

		expect(result).toEqual(['Elysia', 'Eden'].map((x) => `data: ${x}\n\n`))
		expect(response.headers.get('content-type')).toBe('text/event-stream')
	})

	// Issue #1677: Throwing from AsyncGenerator should preserve headers
	it('should preserve headers when throwing from async generator', async () => {
		const { status: statusFn } = await import('../../src')

		const app = new Elysia().get('/', async function* ({ set }) {
			set.headers['access-control-allow-origin'] = '*'
			set.headers['x-custom-header'] = 'test-value'
			// Throw before yielding - this is the bug scenario from #1677
			if (true) throw statusFn(500)
			yield 'unreachable'
		})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(500)
		expect(response.headers.get('access-control-allow-origin')).toBe('*')
		expect(response.headers.get('x-custom-header')).toBe('test-value')
	})

	// Issue #1677: onError hook should be called when throwing from generator
	it('should call onError hook when throwing from async generator', async () => {
		const { status: statusFn } = await import('../../src')
		let onErrorCalled = false
		let errorStatus: number | undefined

		const app = new Elysia()
			.error(({ error }) => {
				onErrorCalled = true
				errorStatus = (error as any)?.status
			})
			.get('/', async function* ({ set }) {
				set.headers['x-custom-header'] = 'test-value'
				// Throw before yielding - this is the bug scenario from #1677
				if (true) throw statusFn(500)
				yield 'unreachable'
			})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(500)
		expect(onErrorCalled).toBe(true)
		expect(errorStatus).toBe(500)
		expect(response.headers.get('x-custom-header')).toBe('test-value')
	})

	it('handle sse with plugin global hooks and trace', async () => {
		const PluginA = () =>
			new Elysia({ name: 'PluginA' })
				.beforeHandle(() => {})
				.afterHandle(() => {})
				.parse(() => {})
				.transform(() => {})
				.error(() => {})
				.afterResponse(() => {})
				.onStart(() => {})
				.onStop(() => {})
				.request(() => {})
				.trace(() => {})
				.as('global')

		const app = new Elysia().use(PluginA()).get('/sse', async function* () {
			yield sse({ event: 'message', data: { meow: '1' } })
			yield sse({ event: 'message', data: { meow: '2' } })
			yield sse({ event: 'message', data: { meow: '3' } })
		})

		const response = await app.handle(req('/sse'))
		expect(response.headers.get('content-type')).toBe('text/event-stream')

		const result = []

		for await (const chunk of streamResponse(response)) result.push(chunk)
		expect(result).toHaveLength(3)
		expect(result).toEqual([
			'event: message\ndata: {"meow":"1"}\n\n',
			'event: message\ndata: {"meow":"2"}\n\n',
			'event: message\ndata: {"meow":"3"}\n\n'
		])
	})

	// Regression: proxying a large upstream SSE stream caused OOM (#1801).
	// The upstream generator must not be drained ahead of the slow consumer.
	it('does not buffer unboundedly when proxying a slow-consuming SSE stream', async () => {
		const TOTAL = 50
		let produced = 0

		const upstream = new Elysia().get('/', async function* () {
			for (let i = 0; i < TOTAL; i++) {
				produced++
				yield sse(`message ${i}`)
			}
		})

		// Simulate the OOM scenario: one Elysia instance re-streams another's
		// SSE response while the consumer reads slowly.
		const proxy = new Elysia().get('/', () =>
			upstream.handle(new Request('http://e.ly'))
		)

		const response = await proxy.handle(req('/'))
		const reader = response.body!.getReader()

		// Slow consumer: read 3 chunks with pauses between each
		await reader.read()
		await Bun.sleep(20)
		await reader.read()
		await Bun.sleep(20)
		await reader.read()

		// The upstream generator must not have raced ahead and produced all
		// TOTAL chunks. A small prefetch buffer is fine, but nowhere near 50.
		expect(produced).toBeLessThan(TOTAL)

		reader.cancel()
	})

	// Regression test for https://github.com/elysiajs/elysia/issues/1801
	// The generator must not be drained ahead of the consumer (backpressure).
	it('does not eagerly drain generator ahead of consumer', async () => {
		let nextCallCount = 0

		async function* lazyGenerator() {
			for (let i = 0; i < 10; i++) {
				nextCallCount++
				yield String(i)
			}
		}

		const app = new Elysia().get('/', lazyGenerator)

		const response = await app.handle(req('/'))
		const reader = response.body!.getReader()

		// Read only the first 3 chunks
		await reader.read()
		await reader.read()
		await reader.read()

		// With pull()-based backpressure the generator should not have
		// been advanced far beyond what was consumed. Allow a small buffer
		// (ReadableStream may prefetch one extra chunk via pull()) but it
		// must not have drained all 10.
		expect(nextCallCount).toBeLessThan(10)

		reader.cancel()
	})

	it('stream ReadableStream binary chunks', async () => {
		const payload = new Uint8Array(128 * 1024)

		for (let i = 0; i < payload.length; i++) payload[i] = i % 251

		const app = new Elysia().get(
			'/',
			() =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(payload.subarray(0, 32768))
						controller.enqueue(payload.subarray(32768, 65536))
						controller.enqueue(payload.subarray(65536, 98304))
						controller.enqueue(payload.subarray(98304))
						controller.close()
					}
				})
		)

		const response = await app.handle(req('/'))
		const result = new Uint8Array(await response.arrayBuffer())

		expect(result.byteLength).toBe(payload.byteLength)
		expect(result).toEqual(payload)
	})

	it('stream ReadableStream binary views and blob chunks', async () => {
		const source = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
		const expected = new Uint8Array([6, 7, 8, 9, 2, 3, 4, 5, 10, 11, 12])

		const app = new Elysia().get(
			'/',
			() =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(source.subarray(6, 10))
						controller.enqueue(new DataView(source.buffer, 2, 4))
						controller.enqueue(
							new Blob([new Uint8Array([10, 11, 12])])
						)
						controller.close()
					}
				})
		)

		const response = await app.handle(req('/'))
		const result = new Uint8Array(await response.arrayBuffer())

		expect(result).toEqual(expected)
	})

	// F20: re-streamed Response bodies must pass through byte-identical —
	// UTF-8 decoding each chunk corrupted non-UTF-8 bytes (U+FFFD) and
	// multi-byte characters split across chunk boundaries
	it('preserve exact bytes when re-streaming a touched-set chunked Response', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-touch'] = '1'

			return new Response(
				new ReadableStream({
					start(controller) {
						// € (e2 82 ac) split across chunks + non-UTF-8 tail
						controller.enqueue(new Uint8Array([0xe2, 0x82]))
						controller.enqueue(new Uint8Array([0xac, 0xff, 0x00]))
						controller.close()
					}
				}),
				{ headers: { 'transfer-encoding': 'chunked' } }
			)
		})

		const response = await app.handle(req('/'))
		const result = new Uint8Array(await response.arrayBuffer())

		expect(response.headers.get('x-touch')).toBe('1')
		// binary first chunk pins the deliberate headerless default
		expect(response.headers.get('content-type')).toBe(
			'application/octet-stream'
		)
		expect(result).toEqual(new Uint8Array([0xe2, 0x82, 0xac, 0xff, 0x00]))
	})

	it('stream generator Uint8Array chunks as binary', async () => {
		const app = new Elysia().get('/', async function* () {
			yield new Uint8Array([1, 2])
			await Bun.sleep(1)
			yield new Uint8Array([3, 4])
		})

		const response = await app.handle(req('/'))
		const result = new Uint8Array(await response.arrayBuffer())

		// expect(result).toEqual(result.toBase64())

		expect(result).toEqual(new Uint8Array([1, 2, 3, 4]))
	})
})
