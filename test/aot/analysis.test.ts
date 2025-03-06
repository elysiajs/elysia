/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'
import { hasType } from '../../src/schema'

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

	it('parse context access using square bracket', async () => {
		const app = new Elysia().post('/', (context) => context['body'])

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

	it('find nested Elysia Schema', () => {
		const schema = t.Object({
			a: t.Object({
				b: t.Object({
					c: t.File()
				}),
				d: t.String()
			}),
			id: t.Numeric(),
			b: t.Object({
				c: t.File()
			})
		})

		expect(hasType('File', schema)).toBeTrue()
	})

	it('find Elysia Schema on root', () => {
		const schema = t.Numeric()

		expect(hasType('Numeric', schema)).toBeTrue
	})

	it('find return null if Elysia Schema is not found', () => {
		const schema = t.Object({
			a: t.Object({
				b: t.Object({
					c: t.Number()
				}),
				d: t.String()
			}),
			id: t.Number(),
			b: t.Object({
				c: t.Number()
			})
		})

		expect(hasType('File', schema)).toBeFalse()
	})

	it('restart server once analyze', async () => {
		const plugin = async () => {
			await new Promise((resolve) => setTimeout(resolve, 1))

			return (app: Elysia) => app.get('/', () => 'hi')
		}

		const app = new Elysia().use(plugin())

		await new Promise((resolve) => setTimeout(resolve, 25))

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('hi')
	})

	it('parse custom parser with schema', async () => {
		const app = new Elysia()
			.onParse((request, contentType) => {
				if (contentType === 'application/elysia') return 'hi'
			})
			.post('/', ({ body }) => body, {
				body: t.String()
			})

		await new Promise((resolve) => setTimeout(resolve, 25))

		const response = await app
			.handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: {
						'content-type': 'application/elysia'
					},
					body: 'need correction'
				})
			)
			.then((x) => x.text())

		expect(response).toBe('hi')
	})

	it('handle multiple numeric type', async () => {
		const app = new Elysia()
			.get('/', () => 'Hello Elysia1')
			.get(
				'/products',
				({ query }) =>
					`pageIndex=${query.pageIndex}; pageSize=${query.pageSize}`,
				{
					query: t.Object({
						pageIndex: t.Numeric(),
						pageSize: t.Numeric()
					})
				}
			)

		const response = await app
			.handle(req('/products?pageIndex=1&pageSize=2'))
			.then((x) => x.text())

		expect(response).toBe(`pageIndex=1; pageSize=2`)
	})

	it('break out of switch map when path is not found', async () => {
		const app = new Elysia()
			.options('/', () => 'hi')
			.get('/games', () => 'games')

		const response = await app
			.handle(
				new Request('http://localhost/', {
					method: 'OPTIONS'
				})
			)
			.then((x) => x.text())

		expect(response).toBe('hi')
	})

	it('handle accurate trie properties', async () => {
		const app = new Elysia().get('/what', ({ query }) => query, {
			query: t.Object({
				stee: t.Optional(t.Literal('on')),
				mtee: t.Optional(t.Literal('on')),
				ltee: t.Optional(t.Literal('on')),
				xltee: t.Optional(t.Literal('on')),
				xxltee: t.Optional(t.Literal('on')),
				xxxltee: t.Optional(t.Literal('on'))
			})
		})

		const response = await app
			.handle(req('/what?xxltee=on'))
			.then((x) => x.json())

		expect(response).toEqual({
			xxltee: 'on'
		})
	})
})
