import { describe, it, expect } from 'bun:test'
import { req } from '../utils'

import { Elysia } from '../../src'

function textEventStream(items: string[]) {
	return items.map((item) => `event: message\ndata: ${JSON.stringify(item)}\n\n`).join('')
}

function parseTextEventStreamItem(item: string) {
	const data = item.split('data: ')[1].split('\n')[0]
	return JSON.parse(data)
}

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

					expect(parseTextEventStreamItem(value.toString())).toBe(
						expected.shift()!
					)

					acc += value.toString()
					return reader.read().then(pump)
				})

				return promise
			})

		expect(expected).toHaveLength(0)
		expect(response).toBe(textEventStream(['a', 'b', 'c']))
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
					if (done) {
						console.log({ value })
						return resolve(acc)
					}

					expect(parseTextEventStreamItem(value.toString())).toBe(
						expected.shift()!
					)

					acc += value.toString()
					return reader.read().then(pump)
				})

				return promise
			})

		expect(expected).toHaveLength(0)
		expect(response).toBe(textEventStream(['a', 'b']))
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
})
