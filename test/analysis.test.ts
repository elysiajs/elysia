import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'
import { post } from './utils'

const payload = { hello: 'world' }

describe('Static code analysis', () => {
	it('parse object destructuring', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const res = await app.handle(post('/', payload)).then((x) => x.json())

		expect(res).toEqual(payload)
	})

	it('parse context access', async () => {
		const app = new Elysia().post('/', (context) => context.body)

		const res = await app.handle(post('/', payload)).then((x) => x.json())

		expect(res).toEqual(payload)
	})

	it('parse assignment', async () => {
		const app = new Elysia().post('/', (context) => {
			const a = context.body

			return a
		})

		const res = await app.handle(post('/', payload)).then((x) => x.json())

		expect(res).toEqual(payload)
	})

	it('parse multiple assignment', async () => {
		const app = new Elysia().post('/', (context) => {
			const _ = 1,
				b = context.body

			return b
		})

		const res = await app.handle(post('/', payload)).then((x) => x.json())

		expect(res).toEqual(payload)
	})

	it('parse multiple assignment with object destructuring', async () => {
		const app = new Elysia().post('/', (context) => {
			const _ = 1,
				{ body } = context

			return body
		})

		const res = await app.handle(post('/', payload)).then((x) => x.json())

		expect(res).toEqual(payload)
	})

	it('parse lazy object destructuring', async () => {
		const app = new Elysia().post('/', (context) => {
			const { body: a } = context

			return a
		})

		const res = await app.handle(post('/', payload)).then((x) => x.json())

		expect(res).toEqual(payload)
	})

	it('parse headers', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers)

		const res = await app
			.handle(
				new Request('http://localhost/', {
					headers: payload
				})
			)
			.then((x) => x.json())

		expect(res).toEqual(payload)
	})

	it('parse body type json', async () => {
		const body = {
			message: 'Rikuhachima Aru'
		}

		const app = new Elysia().post('/json', (c) => c.body, {
			type: 'json'
		})

		const res = await app.handle(post('/json', body)).then((x) => x.json())

		expect(res).toEqual(body)
	})
})
