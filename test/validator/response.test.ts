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

	it('strictly validate by default', async () => {
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

		const res = await app.handle(req('/'))

		expect(res.status).toBe(400)
	})

	it('strictly validate by default', async () => {
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

		const res = await app.handle(req('/'))

		expect(res.status).toBe(400)
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
		expect(r200invalid.status).toBe(400)
		expect(r201valid.status).toBe(201)
		expect(r201invalid.status).toBe(400)
	})

	it('validate response per status with error()', async () => {
		const app = new Elysia().get(
			'/',
			// @ts-ignore
			() => {
				return error(418, 'I am a teapot')
			},
			{
				response: {
					200: t.String(),
					418: t.String()
				}
			}
		)
	})
})
