import { Elysia, error, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req, upload } from '../utils'

describe('Response Validator', () => {
	it('validate primitive', async () => {
		const app = new Elysia().get('/', () => 'sucrose', {
			response: t.String()
		})
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate number', async () => {
		const app = new Elysia().get('/', () => 1, {
			response: t.Number()
		})
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('1')
		expect(res.status).toBe(200)
	})

	it('validate boolean', async () => {
		const app = new Elysia().get('/', () => true, {
			response: t.Boolean()
		})
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('true')
		expect(res.status).toBe(200)
	})

	it('validate literal', async () => {
		const app = new Elysia().get('/', () => 'A' as const, {
			response: t.Literal('A')
		})
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('A')
		expect(res.status).toBe(200)
	})

	it('validate single', async () => {
		const app = new Elysia().get(
			'/',
			() => ({
				name: 'sucrose'
			}),
			{
				response: t.Object({
					name: t.String()
				})
			}
		)
		const res = await app.handle(req('/'))

		expect(await res.json()).toEqual({ name: 'sucrose' })
		expect(res.status).toBe(200)
	})

	it('validate multiple', async () => {
		const app = new Elysia().get(
			'/',
			() => ({
				name: 'sucrose',
				job: 'alchemist',
				trait: 'dog'
			}),
			{
				response: t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.String()
				})
			}
		)
		const res = await app.handle(req('/'))

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			trait: 'dog'
		})
		expect(res.status).toBe(200)
	})

	it('parse without reference', async () => {
		const app = new Elysia().get(
			'/',
			() => ({
				name: 'sucrose',
				job: 'alchemist',
				trait: 'dog'
			}),
			{
				response: t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.String()
				})
			}
		)
		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
	})

	it('validate optional', async () => {
		const app = new Elysia().get(
			'/',
			() => ({
				name: 'sucrose',
				job: 'alchemist'
			}),
			{
				response: t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String())
				})
			}
		)
		const res = await app.handle(req('/'))

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist'
		})
		expect(res.status).toBe(200)
	})

	it('allow undefined', async () => {
		const app = new Elysia().get('/', () => {}, {
			body: t.Union([
				t.Undefined(),
				t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String())
				})
			])
		})
		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('')
	})

	it('normalize by default', async () => {
		const app = new Elysia().get(
			'/',
			() => ({
				name: 'sucrose',
				job: 'alchemist'
			}),
			{
				response: t.Object({
					name: t.String()
				})
			}
		)

		const res = await app.handle(req('/')).then((x) => x.json())

		expect(res).toEqual({
			name: 'sucrose'
		})
	})

	it('strictly validate if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			() => ({
				name: 'sucrose',
				job: 'alchemist'
			}),
			{
				response: {
					200: t.Object({
						name: t.String()
					})
				}
			}
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(422)
	})

	it('handle File', async () => {
		const app = new Elysia().post('/', ({ body: { file } }) => file.size, {
			body: t.Object({
				file: t.File()
			})
		})

		expect(
			await app
				.handle(
					upload('/', {
						file: 'aris-yuzu.jpg'
					}).request
				)
				.then((x) => x.text())
		).toBe(Bun.file('./test/images/aris-yuzu.jpg').size + '')
	})

	it('convert File to Files automatically', async () => {
		const app = new Elysia().post(
			'/',
			({ body: { files } }) => Array.isArray(files),
			{
				body: t.Object({
					files: t.Files()
				})
			}
		)

		expect(
			await app
				.handle(
					upload('/', {
						files: 'aris-yuzu.jpg'
					}).request
				)
				.then((x) => x.text())
		).toEqual('true')

		expect(
			await app
				.handle(
					upload('/', {
						files: ['aris-yuzu.jpg', 'midori.png']
					}).request
				)
				.then((x) => x.text())
		).toEqual('true')
	})

	it('validate response per status', async () => {
		const app = new Elysia().post(
			'/',
			({ set, body: { status, response } }) => {
				set.status = status

				return response
			},
			{
				body: t.Object({
					status: t.Number(),
					response: t.Any()
				}),
				response: {
					200: t.String(),
					201: t.Number()
				}
			}
		)

		const r200valid = await app.handle(
			post('/', {
				status: 200,
				response: 'String'
			})
		)
		const r200invalid = await app.handle(
			post('/', {
				status: 200,
				response: 1
			})
		)

		const r201valid = await app.handle(
			post('/', {
				status: 201,
				response: 1
			})
		)
		const r201invalid = await app.handle(
			post('/', {
				status: 201,
				response: 'String'
			})
		)

		expect(r200valid.status).toBe(200)
		expect(r200invalid.status).toBe(422)
		expect(r201valid.status).toBe(201)
		expect(r201invalid.status).toBe(422)
	})

	it('validate response per status with error()', async () => {
		const app = new Elysia().get('/', () => error(418, 'I am a teapot'), {
			response: {
				200: t.String(),
				418: t.String()
			}
		})
	})

	it('use inline error from handler', async () => {
		const app = new Elysia().get(
			'/',
			({ error }) => error(418, 'I am a teapot'),
			{
				response: {
					200: t.String(),
					418: t.String()
				}
			}
		)
	})

	it('return null with schema', async () => {
		const app = new Elysia().get('/', () => null, {
			response: t.Union([
				t.Null(),
				t.Object({
					name: t.String()
				})
			])
		})
	})

	it('return undefined with schema', async () => {
		const app = new Elysia().get('/', () => undefined, {
			response: t.Union([
				t.Undefined(),
				t.Object({
					name: t.String()
				})
			])
		})
	})

	it('return void with schema', async () => {
		const app = new Elysia().get('/', () => undefined, {
			response: t.Union([
				t.Void(),
				t.Object({
					name: t.String()
				})
			])
		})
	})

	it('return null with status based schema', async () => {
		const app = new Elysia().get('/', () => undefined, {
			response: {
				200: t.Union([
					t.Void(),
					t.Object({
						name: t.String()
					})
				]),
				418: t.String()
			}
		})
	})

	it('return static undefined with status based schema', async () => {
		const app = new Elysia().get('/', undefined, {
			response: {
				200: t.Union([
					t.Void(),
					t.Object({
						name: t.String()
					})
				]),
				418: t.String()
			}
		})
	})

	it('return error response with validator', async () => {
		const app = new Elysia()
			.get('/ok', ({ error }) => 'ok', {
				response: {
					200: t.String(),
					418: t.Literal('Kirifuji Nagisa'),
					420: t.Literal('Snoop Dogg')
				}
			})
			.get(
				'/error',
				({ error }) => error("I'm a teapot", 'Kirifuji Nagisa'),
				{
					response: {
						200: t.String(),
						418: t.Literal('Kirifuji Nagisa'),
						420: t.Literal('Snoop Dogg')
					}
				}
			)
			.get(
				'/validate-error',
				// @ts-expect-error
				({ error }) => error("I'm a teapot", 'Nagisa'),
				{
					response: {
						200: t.String(),
						418: t.Literal('Kirifuji Nagisa'),
						420: t.Literal('Snoop Dogg')
					}
				}
			)

		const response = await Promise.all([
			app.handle(req('/ok')).then((x) => x.status),
			app.handle(req('/error')).then((x) => x.status),
			app.handle(req('/validate-error')).then((x) => x.status)
		])

		expect(response).toEqual([200, 418, 422])
	})

	it('validate nested references', async () => {
		const job = t.Object(
			{
				name: t.String()
			},
			{ $id: 'job' }
		)

		const person = t.Object({
			name: t.String(),
			job: t.Ref(job)
		})

		const app = new Elysia().model({ job, person }).get(
			'/',
			() => ({
				name: 'sucrose',
				job: { name: 'alchemist' }
			}),
			{
				response: person
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
	})
})
