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
})
