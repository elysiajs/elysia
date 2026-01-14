import { Elysia, t, sse } from '../../src'
import { streamResponse } from '../../src/adapter/utils'
import * as z from 'zod'

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

		// Response validation errors return 500 (server error) - see issue #1480
		expect(res.status).toBe(500)
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
		// Response validation errors return 500 (server error) - see issue #1480
		expect(r200invalid.status).toBe(500)
		expect(r201valid.status).toBe(201)
		expect(r201invalid.status).toBe(500)
	})

	it('validate response per status with error()', async () => {
		const app = new Elysia().get(
			'/',
			({ status }) => status(418, 'I am a teapot'),
			{
				response: {
					200: t.String(),
					418: t.String()
				}
			}
		)
	})

	it('use inline error from handler', async () => {
		const app = new Elysia().get(
			'/',
			({ status }) => status(418, 'I am a teapot'),
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
			.get('/ok', () => 'ok', {
				response: {
					200: t.String(),
					418: t.Literal('Kirifuji Nagisa'),
					420: t.Literal('Snoop Dogg')
				}
			})
			.get(
				'/error',
				({ status }) => status("I'm a teapot", 'Kirifuji Nagisa'),
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
				// @ts-ignore
				({ status }) => status("I'm a teapot", 'Nagisa'),
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

		// Response validation errors return 500 (server error) - see issue #1480
		expect(response).toEqual([200, 418, 500])
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

	it('validate SSE response with generator', async () => {
		const app = new Elysia().get(
			'/',
			function* () {
				yield sse({ data: { name: 'Alice' } })
				yield sse({ data: { name: 'Bob' } })
			},
			{
				response: t.Object({
					data: t.Object({
						name: t.String()
					})
				})
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
			async function* () {
				yield sse({ data: { name: 'Charlie' } })
				await Bun.sleep(1)
				yield sse({ data: { name: 'Diana' } })
			},
			{
				response: t.Object({
					data: t.Object({
						name: t.String()
					})
				})
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('text/event-stream')
	})

	it('validate streaming response with generator', async () => {
		const app = new Elysia().get(
			'/',
			function* () {
				yield { message: 'first' }
				yield { message: 'second' }
			},
			{
				response: t.Object({
					message: t.String()
				})
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

		const app = new Elysia().get(
			'/',
			function* () {
				yield sse({ data: { name: 'Name' } })
			},
			{ response: Schema }
		)

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
})

// https://github.com/elysiajs/elysia/issues/1480
describe('Response Validation Error Status Code', () => {
	it('should return 500 for response validation errors', async () => {
		// Response validation errors are server bugs - the server is returning
		// data that doesn't match its own declared schema
		const app = new Elysia().get(
			'/',
			() => ({ wrong: 'field' }),
			{
				response: t.Object({ name: t.String() })
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(500)
	})

	it('should return 500 with correct error structure for response validation', async () => {
		const app = new Elysia().get(
			'/',
			() => ({ count: 'not a number' }),
			{
				response: t.Object({ count: t.Number() })
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(500)

		const body = await res.json()
		expect(body.type).toBe('validation')
		expect(body.on).toBe('response')
	})

	it('should return 500 for response validation with status-specific schema', async () => {
		const app = new Elysia().get(
			'/',
			() => ({ invalid: 'data' }),
			{
				response: {
					200: t.Object({ success: t.Boolean() })
				}
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(500)
	})

	it('should return 500 when response has missing required fields', async () => {
		const app = new Elysia().get(
			'/',
			// @ts-ignore - intentionally returning incomplete object
			() => ({ name: 'test' }),
			{
				response: t.Object({
					name: t.String(),
					age: t.Number(),
					email: t.String()
				})
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(500)
	})

	it('should return 500 when response has wrong type', async () => {
		const app = new Elysia().get(
			'/',
			() => 'string instead of object',
			{
				response: t.Object({ name: t.String() })
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(500)
	})

	it('should return 200 when response passes validation', async () => {
		const app = new Elysia().get(
			'/',
			() => ({ name: 'valid', count: 42 }),
			{
				response: t.Object({
					name: t.String(),
					count: t.Number()
				})
			}
		)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
	})

	it('should return 422 for request body validation errors (not 500)', async () => {
		// Request validation errors are client errors - the client sent invalid data
		const app = new Elysia().post(
			'/',
			({ body }) => body,
			{
				body: t.Object({ name: t.String() })
			}
		)

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ wrong: 'field' })
			})
		)
		expect(res.status).toBe(422)
	})

	it('should return 422 for query validation errors (not 500)', async () => {
		const app = new Elysia().get(
			'/',
			({ query }) => query,
			{
				query: t.Object({ required: t.String() })
			}
		)

		// Missing required query parameter
		const res = await app.handle(req('/'))
		expect(res.status).toBe(422)
	})

	it('should return 422 for params validation errors (not 500)', async () => {
		const app = new Elysia().get(
			'/user/:id',
			({ params }) => params,
			{
				params: t.Object({ id: t.Numeric() })
			}
		)

		// Invalid param (not numeric)
		const res = await app.handle(req('/user/not-a-number'))
		expect(res.status).toBe(422)
	})

	it('should return 422 for headers validation errors (not 500)', async () => {
		const app = new Elysia().get(
			'/',
			({ headers }) => headers,
			{
				headers: t.Object({ 'x-required-header': t.String() })
			}
		)

		// Missing required header
		const res = await app.handle(req('/'))
		expect(res.status).toBe(422)
	})

	it('should distinguish between response (500) and request (422) errors in same route', async () => {
		const app = new Elysia().post(
			'/',
			// @ts-ignore - intentionally returning wrong type
			({ body }) => ({ wrong: body.name }),
			{
				body: t.Object({ name: t.String() }),
				response: t.Object({ greeting: t.String() })
			}
		)

		// Valid request but invalid response - should be 500
		const validRequest = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'test' })
			})
		)
		expect(validRequest.status).toBe(500)

		// Invalid request - should be 422
		const invalidRequest = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ wrong: 'field' })
			})
		)
		expect(invalidRequest.status).toBe(422)
	})
})
