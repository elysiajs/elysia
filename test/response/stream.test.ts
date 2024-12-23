import { describe, it, expect } from 'bun:test'
import { req } from '../utils'

import { Elysia } from '../../src'

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

	it.skip('stop stream on canceled request, hangs forever', async () => {
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
})
