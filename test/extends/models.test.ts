/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Model', () => {
	it('add single', async () => {
		const app = new Elysia()
			.model('string', t.String())
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string'])
	})

	it('add multiple', async () => {
		const app = new Elysia()
			.model('string', t.String())
			.model('number', t.Number())
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string', 'number'])
	})

	it('add object', async () => {
		const app = new Elysia()
			.model({
				string: t.String(),
				number: t.Number()
			})
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string', 'number'])
	})

	it('add object', async () => {
		const app = new Elysia()
			.model({
				string: t.String(),
				number: t.Number()
			})
			.model(({ number, ...rest }) => ({
				...rest,
				boolean: t.Boolean()
			}))
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string', 'boolean'])
	})

	it('inherits functional plugin', async () => {
		const plugin = () => (app: Elysia) => app.model('string', t.String())

		const app = new Elysia()
			.use(plugin())
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string'])
	})

	it('inherits instance plugin', async () => {
		const plugin = () => (app: Elysia) => app.model('string', t.String())

		const app = new Elysia()
			.use(plugin())
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string'])
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().decorate('hi', () => 'hi')

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('validate reference model', async () => {
		const app = new Elysia()
			.model({
				number: t.Number()
			})
			.post('/', ({ body: { data } }) => data, {
				response: 'number',
				body: t.Object({
					data: t.Number()
				})
			})
			.post('/arr', ({ body }) => body, {
				response: 'number[]',
				body: 'number[]',
			})

		const correct = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					data: 1
				})
			})
		)

		expect(correct.status).toBe(200)

		const correctArr = await app.handle(
			new Request('http://localhost/arr', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify([1, 2])
			})
		)

		expect(correctArr.status).toBe(200)

		const wrong = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					data: true
				})
			})
		)

		expect(wrong.status).toBe(422)

		const wrongArr = await app.handle(
			new Request('http://localhost/arr', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					data: true
				})
			})
		)

		expect(wrongArr.status).toBe(422)
	})

	it('remap', async () => {
		const app = new Elysia()
			.model('string', t.String())
			.model('number', t.Number())
			.model(({ number, ...rest }) => ({
				...rest,
				numba: number
			}))
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string', 'numba'])
	})

	it('use reference model', async () => {
		const app = new Elysia()
			.model({
				string: t.Object({
					data: t.String()
				})
			})
			.post('/', ({ body }) => body, {
				body: 'string'
			})

		const error = await app.handle(post('/'))
		expect(error.status).toBe(422)

		const correct = await app.handle(
			post('/', {
				data: 'hi'
			})
		)
		expect(correct.status).toBe(200)
	})

	it('use coerce with reference model', async () => {
		const app = new Elysia()
			.model({
				number: t.Number(),
				optionalNumber: t.Optional(t.Ref('number'))
			})
			.post('/', ({ body }) => body, {
				body: 'optionalNumber'
			})

		const error = await app.handle(post('/'))
		expect(error.status).toBe(422)

		const correct = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'content-type': 'text/plain; charset=utf-8'
				},
				body: '0'
			})
		)
		expect(correct.status).toBe(200)
	})

	it('create default value with nested reference model', async () => {
		const app = new Elysia()
			.model({
				number: t.Number({ default: 0 }),
				optionalNumber: t.Optional(t.Ref('number'))
			})
			.post('/', ({ body }) => body, {
				body: t.Optional(t.Ref('number'))
			})

		const result = await app.handle(post('/')).then((x) => x.text())

		expect(result).toBe('0')
	})

	it('create default value with reference model', async () => {
		const app = new Elysia()
			.model({
				number: t.Number({ default: 0 }),
				optionalNumber: t.Optional(t.Ref('number'))
			})
			.post('/', ({ body }) => body, { body: 'optionalNumber' })

		const result = await app.handle(post('/')).then((x) => x.text())

		expect(result).toBe('0')
	})

	it('use reference model with cookie', async () => {
		const app = new Elysia()
			.model({
				session: t.Cookie({ token: t.Number() }),
				optionalSession: t.Optional(t.Ref('session'))
			})
			.get('/', () => 'Hello Elysia', { cookie: 'optionalSession' })

		const error = await app.handle(
			new Request('http://localhost/', {
				headers: {
					cookie: 'token=string'
				}
			})
		)
		expect(error.status).toBe(422)

		const correct = await app.handle(
			new Request('http://localhost/', {
				headers: {
					cookie: 'token=1'
				}
			})
		)
		expect(correct.status).toBe(200)
	})

	it('use reference model with response', async () => {
		const app = new Elysia()
			.model({
				res: t.String()
			})
			.get('/correct', () => 'Hello Elysia', { response: 'res' })
			// @ts-expect-error
			.get('/error', () => 1, { response: 'res' })

		const error = await app.handle(req('/error'))
		expect(error.status).toBe(422)

		const correct = await app.handle(req('/correct'))
		expect(correct.status).toBe(200)
	})

	it('use reference model with response per status', async () => {
		const app = new Elysia()
			.model({
				res: t.String()
			})
			.get('/correct', () => 'Hello Elysia', {
				response: {
					200: 'res',
					400: 'res'
				}
			})
			.get('/400', ({ error }) => error(400, 'ok'), {
				response: {
					200: 'res',
					400: 'res'
				}
			})
			// @ts-expect-error
			.get('/error', ({ error }) => error(400, 1), {
				response: {
					200: 'res',
					400: 'res'
				}
			})

		const error = await app.handle(req('/error'))
		expect(error.status).toBe(422)

		const correct = await app.handle(req('/correct'))
		expect(correct.status).toBe(200)

		const correct400 = await app.handle(req('/400'))
		expect(correct400.status).toBe(400)
	})
})
