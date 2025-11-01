import { describe, it, expect } from 'bun:test'
import { req } from '../utils'

import { Elysia, sse } from '../../src'
import { streamResponse } from '../../src/adapter/utils'
import { randomId } from '../../src/utils'

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

	it('return value if not yield', async () => {
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

		expect(await response[0].text()).toBe('hello')
		expect(await response[1].json()).toEqual({
			hello: 'world'
		})
	})

	it('return async value if not yield', async () => {
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

		expect(await response[0].text()).toBe('hello')
		expect(await response[1].json()).toEqual({
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
					id: randomId(),
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


	it('continue stream when autoCancellation is disabled', async () => {
		const { createStreamHandler } = await import('../../src/adapter/utils')
		const sideEffects: string[] = []

		const mockMapResponse = (value: any) =>
			new Response(value)
		const mockMapCompactResponse = (value: any) =>
			new Response(value)

		const streamHandler = createStreamHandler({
			mapResponse: mockMapResponse,
			mapCompactResponse: mockMapCompactResponse,
			streamOptions: { autoCancellation: false }
		})

		async function* testGenerator() {
			sideEffects.push('a')
			yield 'a'
			await Bun.sleep(20)

			sideEffects.push('b')
			yield 'b'
			await Bun.sleep(20)

			sideEffects.push('c')
			yield 'c'
		}

		const controller = new AbortController()
		const request = new Request('http://e.ly', {
			signal: controller.signal
		})

		setTimeout(() => {
			controller.abort()
		}, 15)

		const response = await streamHandler(testGenerator(), undefined, request)
		const reader = response.body?.getReader()

		if (!reader) throw new Error('No reader')

		const results: string[] = []
		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				results.push(new TextDecoder().decode(value))
			}
		} catch (e) {
			// Expected to error when abort happens
		}

		await Bun.sleep(100)

		expect(sideEffects).toEqual(['a', 'b', 'c'])
	})

	it('stop stream when autoCancellation is enabled (default)', async () => {
		const { createStreamHandler } = await import('../../src/adapter/utils')
		const sideEffects: string[] = []

		const mockMapResponse = (value: any) =>
			new Response(value)
		const mockMapCompactResponse = (value: any) =>
			new Response(value)

		const streamHandler = createStreamHandler({
			mapResponse: mockMapResponse,
			mapCompactResponse: mockMapCompactResponse,
			streamOptions: { autoCancellation: true }
		})

		async function* testGenerator() {
			sideEffects.push('a')
			yield 'a'
			await Bun.sleep(20)

			sideEffects.push('b')
			yield 'b'
			await Bun.sleep(20)

			sideEffects.push('c')
			yield 'c'
		}

		const controller = new AbortController()
		const request = new Request('http://e.ly', {
			signal: controller.signal
		})

		setTimeout(() => {
			controller.abort()
		}, 15)

		const response = await streamHandler(testGenerator(), undefined, request)
		const reader = response.body?.getReader()

		if (!reader) throw new Error('No reader')

		const results: string[] = []
		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				results.push(new TextDecoder().decode(value))
			}
		} catch (e) {
			// Expected to error when abort happens
		}

		await Bun.sleep(100)

		expect(sideEffects).toHaveLength(2)
		expect(sideEffects).toEqual(['a', 'b'])
	})
})
