import { Elysia, t, sse } from '../../src'
import { streamResponse } from '../../src/adapter/utils'
import * as z from 'zod'

import { describe, expect, it } from 'bun:test'
import { post, req, upload } from '../utils'

describe('Response Validator', () => {
	it('validate primitive', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.String()
			},
			() => 'sucrose'
		)
		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate number', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Number()
			},
			() => 1
		)
		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('1')
		expect(res.status).toBe(200)
	})

	it('validate boolean', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Boolean()
			},
			() => true
		)
		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('true')
		expect(res.status).toBe(200)
	})

	it('validate literal', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Literal('A')
			},
			() => 'A' as const
		)
		const res = await app.handle(req('/'))

		await expect(res.text()).resolves.toBe('A')
		expect(res.status).toBe(200)
	})

	it('validate single', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					name: t.String()
				})
			},
			() => ({
				name: 'sucrose'
			})
		)
		const res = await app.handle(req('/'))

		await expect(res.json()).resolves.toEqual({ name: 'sucrose' })
		expect(res.status).toBe(200)
	})

	it('validate multiple', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.String()
				})
			},
			() => ({
				name: 'sucrose',
				job: 'alchemist',
				trait: 'dog'
			})
		)
		const res = await app.handle(req('/'))

		await expect(res.json()).resolves.toEqual({
			name: 'sucrose',
			job: 'alchemist',
			trait: 'dog'
		})
		expect(res.status).toBe(200)
	})

	it('parse without reference', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.String()
				})
			},
			() => ({
				name: 'sucrose',
				job: 'alchemist',
				trait: 'dog'
			})
		)
		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
	})

	it('validate optional', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String())
				})
			},
			() => ({
				name: 'sucrose',
				job: 'alchemist'
			})
		)
		const res = await app.handle(req('/'))

		await expect(res.json()).resolves.toEqual({
			name: 'sucrose',
			job: 'alchemist'
		})
		expect(res.status).toBe(200)
	})

	it('allow undefined', async () => {
		const app = new Elysia().get(
			'/',
			{
				body: t.Union([
					t.Undefined(),
					t.Object({
						name: t.String(),
						job: t.String(),
						trait: t.Optional(t.String())
					})
				])
			},
			() => {}
		)
		const res = await app.handle(req('/'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('')
	})

	it('normalize by default', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					name: t.String()
				})
			},
			() => ({
				name: 'sucrose',
				job: 'alchemist'
			})
		)

		const res = await app.handle(req('/')).then((x) => x.json())

		expect(res).toEqual({
			name: 'sucrose'
		})
	})

	it('strictly validate if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			{
				response: {
					200: t.Object({
						name: t.String()
					})
				}
			},
			() => ({
				name: 'sucrose',
				job: 'alchemist'
			})
		)

		const res = await app.handle(req('/'))

		expect(res.status).toBe(422)
	})

	it('handle File', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File()
				})
			},
			({ body: { file } }) => file.size
		)

		await expect(
			app
				.handle(
					upload('/', {
						file: 'aris-yuzu.jpg'
					}).request
				)
				.then((x) => x.text())
		).resolves.toBe(Bun.file('./test/images/aris-yuzu.jpg').size + '')
	})

	it('convert File to Files automatically', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					files: t.Files()
				})
			},
			({ body: { files } }) => Array.isArray(files)
		)

		await expect(
			app
				.handle(
					upload('/', {
						files: 'aris-yuzu.jpg'
					}).request
				)
				.then((x) => x.text())
		).resolves.toEqual('true')

		await expect(
			app
				.handle(
					upload('/', {
						files: ['aris-yuzu.jpg', 'midori.png']
					}).request
				)
				.then((x) => x.text())
		).resolves.toEqual('true')
	})

	it('validate response per status', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					status: t.Number(),
					response: t.Any()
				}),
				response: {
					200: t.String(),
					201: t.Number()
				}
			},
			({ set, body: { status, response } }) => {
				set.status = status

				return response
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
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.String(),
					418: t.String()
				}
			},
			({ status }) => status(418, 'I am a teapot')
		)
	})

	it('use inline error from handler', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.String(),
					418: t.String()
				}
			},
			({ status }) => status(418, 'I am a teapot')
		)
	})

	it('return null with schema', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Union([
					t.Null(),
					t.Object({
						name: t.String()
					})
				])
			},
			() => null
		)
	})

	it('return undefined with schema', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Union([
					t.Undefined(),
					t.Object({
						name: t.String()
					})
				])
			},
			() => undefined
		)
	})

	it('return void with schema', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Union([
					t.Void(),
					t.Object({
						name: t.String()
					})
				])
			},
			() => undefined
		)
	})

	it('return null with status based schema', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.Union([
						t.Void(),
						t.Object({
							name: t.String()
						})
					]),
					418: t.String()
				}
			},
			() => undefined
		)
	})

	it('return static undefined with status based schema', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: {
					200: t.Union([
						t.Void(),
						t.Object({
							name: t.String()
						})
					]),
					418: t.String()
				}
			},
			undefined as any
		)
	})

	it('return error response with validator', async () => {
		const app = new Elysia()
			.get(
				'/ok',
				{
					response: {
						200: t.String(),
						418: t.Literal('Kirifuji Nagisa'),
						420: t.Literal('Snoop Dogg')
					}
				},
				() => 'ok'
			)
			.get(
				'/error',
				{
					response: {
						200: t.String(),
						418: t.Literal('Kirifuji Nagisa'),
						420: t.Literal('Snoop Dogg')
					}
				},
				({ status }) => status("I'm a teapot", 'Kirifuji Nagisa')
			)
			.get(
				'/validate-error',
				{
					response: {
						200: t.String(),
						418: t.Literal('Kirifuji Nagisa'),
						420: t.Literal('Snoop Dogg')
					}
				},
				// @ts-ignore
				({ status }) => status("I'm a teapot", 'Nagisa')
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
			job: t.Ref('job')
		})

		const app = new Elysia().model({ job, person }).get(
			'/',
			{
				response: person
			},
			() => ({
				name: 'sucrose',
				job: { name: 'alchemist' }
			})
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
	})

	it('validate SSE response with generator', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					data: t.Object({
						name: t.String()
					})
				})
			},
			function* () {
				yield sse({ data: { name: 'Alice' } })
				yield sse({ data: { name: 'Bob' } })
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('text/event-stream')

		// Verify the stream contains the expected SSE data
		const result = []
		for await (const chunk of streamResponse(res)) {
			result.push(chunk)
		}

		expect(result.join('')).toContain('data: {"name":"Alice"}')
		expect(result.join('')).toContain('data: {"name":"Bob"}')
	})

	it('validate async SSE response with generator', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					data: t.Object({
						name: t.String()
					})
				})
			},
			async function* () {
				yield sse({ data: { name: 'Charlie' } })
				await Bun.sleep(1)
				yield sse({ data: { name: 'Diana' } })
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('text/event-stream')
	})

	it('validate streaming response with generator', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					message: t.String()
				})
			},
			function* () {
				yield { message: 'first' }
				yield { message: 'second' }
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)

		const result = []
		for await (const chunk of streamResponse(res)) {
			result.push(chunk)
		}

		expect(result.join('')).toContain('"message":"first"')
		expect(result.join('')).toContain('"message":"second"')
	})

	it('validate SSE with Zod schema (bug report scenario)', async () => {
		// This test reproduces the exact bug report:
		// https://github.com/elysiajs/elysia/issues/1490
		const Schema = z.object({
			data: z.object({
				name: z.string()
			})
		})

		const app = new Elysia().get('/', { response: Schema }, function* () {
			yield sse({ data: { name: 'Name' } })
		})

		const res = await app.handle(req('/'))

		// Should not throw validation error
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('text/event-stream')

		// Verify the stream contains the expected SSE data
		const result = []
		for await (const chunk of streamResponse(res)) {
			result.push(chunk)
		}

		expect(result.join('')).toContain('data: {"name":"Name"}')
	})

	it('handle distinct union', () => {
		const app = new Elysia()
			.get(
				'/health',
				{
					response: {
						200: t.Union([
							t.Object({
								status: t.Literal('a'),
								a: t.Object({ b: t.Integer() })
							}),
							t.Object({ status: t.Literal('healthy') })
						])
					}
				},
				() => ({ status: 'healthy' }) as const
			)
			.listen(0)

		const status = app.handle(req('/health')).then((x) => x.status)

		expect(status).resolves.toBe(200)
	})
})
