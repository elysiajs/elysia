import { Elysia, t, sse } from '../../src'
import { streamResponse } from '../../src/adapter/utils'
import * as z from 'zod'

import { describe, expect, it } from 'bun:test'
import { post, upload, json } from '../utils'

// Stream chunks are Uint8Array values.
const dec = new TextDecoder()
const decodeChunk = (v: unknown): string =>
	v instanceof Uint8Array ? dec.decode(v) : String(v)

describe('Response Validator', () => {
	it('validate primitive', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.String()
			},
			() => 'sucrose'
		)
		const res = await app.handle('/')

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
		const res = await app.handle('/')

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
		const res = await app.handle('/')

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
		const res = await app.handle('/')

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
		const res = await app.handle('/')

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
		const res = await app.handle('/')

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
		const res = await app.handle('/')

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
		const res = await app.handle('/')

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
		const res = await app.handle('/')

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

		const res = await app.handle('/').then((x) => x.json())

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

		const res = await app.handle('/')

		expect(res.status).toBe(500)
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
			'/',
			json({
				status: 200,
				response: 'String'
			})
		)
		const r200invalid = await app.handle(
			'/',
			json({
				status: 200,
				response: 1
			})
		)

		const r201valid = await app.handle(
			'/',
			json({
				status: 201,
				response: 1
			})
		)
		const r201invalid = await app.handle(
			'/',
			json({
				status: 201,
				response: 'String'
			})
		)

		expect(r200valid.status).toBe(200)
		expect(r200invalid.status).toBe(500)
		expect(r201valid.status).toBe(201)
		expect(r201invalid.status).toBe(500)
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
			app.handle('/ok').then((x) => x.status),
			app.handle('/error').then((x) => x.status),
			app.handle('/validate-error').then((x) => x.status)
		])

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

		const res = await app.handle('/')
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

		const res = await app.handle('/')
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('text/event-stream')

		// Verify the stream contains the expected SSE data
		const result: string[] = []
		for await (const chunk of streamResponse(res)) {
			result.push(decodeChunk(chunk))
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

		const res = await app.handle('/')
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

		const res = await app.handle('/')
		expect(res.status).toBe(200)

		const result: string[] = []
		for await (const chunk of streamResponse(res)) {
			result.push(decodeChunk(chunk))
		}

		expect(result.join('')).toContain('"message":"first"')
		expect(result.join('')).toContain('"message":"second"')
	})

	it('validates SSE produced with a Zod response schema', async () => {
		const Schema = z.object({
			data: z.object({
				name: z.string()
			})
		})

		const app = new Elysia().get('/', { response: Schema }, function* () {
			yield sse({ data: { name: 'Name' } })
		})

		const res = await app.handle('/')

		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('text/event-stream')

		const result: string[] = []
		for await (const chunk of streamResponse(res)) {
			result.push(decodeChunk(chunk))
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

		const status = app.handle('/health').then((x) => x.status)

		expect(status).resolves.toBe(200)
	})

	// A non-function handler used to be baked into a `Response` at build time,
	// and the JIT skips response validation for anything already a `Response`.
	// The schema was therefore never applied: a field the author declared away
	// still shipped. These pin that a literal is governed by its own schema.
	it('strips an undeclared field from a static literal handler', async () => {
		const app = new Elysia().get(
			'/',
			{ response: t.Object({ name: t.String() }) },
			{ name: 'bob', passwordHash: 'DEADBEEF' } as any
		)

		const res = await app.handle('/')

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ name: 'bob' })
	})

	it('strips an undeclared field from a static literal via a guard', async () => {
		const app = new Elysia()
			.guard({ response: t.Object({ name: t.String() }) })
			.get('/', { name: 'bob', passwordHash: 'DEADBEEF' } as any)

		const res = await app.handle('/')

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ name: 'bob' })
	})

	it('rejects a static literal that violates its own response schema', async () => {
		const app = new Elysia().get(
			'/',
			{ response: t.Object({ name: t.String() }) },
			{ name: 123 } as any
		)

		const res = await app.handle('/')

		expect(res.status).toBe(500)
	})

	// The response validator is keyed on the status (`va.response[set.status]`)
	// and a hook may still move it, so the schema cannot be chosen when the
	// route is built — only per request. This is the case that rules out
	// validating the literal once at build time.
	it('applies the status-keyed response schema a hook selected to a static literal', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle({ set }) {
					set.status = 201
				},
				response: {
					200: t.Object({ name: t.String() }),
					201: t.Object({ secret: t.String() })
				}
			},
			{ name: 'bob', secret: 'S' } as any
		)

		const res = await app.handle('/')

		expect(res.status).toBe(201)
		await expect(res.json()).resolves.toEqual({ secret: 'S' })
	})

	it('treats a static literal exactly like the equivalent function handler', async () => {
		const response = t.Object({ name: t.String() })
		const value = { name: 'bob', passwordHash: 'DEADBEEF' }

		const app = new Elysia()
			.get('/literal', { response }, value as any)
			.get('/function', { response }, () => structuredClone(value) as any)
			.get('/literal-bad', { response }, { name: 123 } as any)
			.get('/function-bad', { response }, () => ({ name: 123 }) as any)

		const [literal, fn, literalBad, fnBad] = await Promise.all(
			['/literal', '/function', '/literal-bad', '/function-bad'].map(
				(path) => app.handle(path)
			)
		)

		expect(literal.status).toBe(fn.status)
		expect(await literal.text()).toBe(await fn.text())

		expect(literalBad.status).toBe(fnBad.status)
		expect(literalBad.status).toBe(500)
	})

	// A literal with no `response` keeps the build-time `Response`, so the fix
	// above must not cost every static route its fast path
	it('keeps serving a static literal that declares no response schema', async () => {
		const app = new Elysia().get('/', { name: 'bob' } as any)

		const res = await app.handle('/')

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ name: 'bob' })
	})

	// Validating a literal per request means the hooks that run before
	// validation see the value itself rather than a finished `Response`. Every
	// request must get its own copy: a hook stamping the caller onto the
	// response would otherwise hand the next caller the previous one's data,
	// and corrupt the route's own literal for the life of the process
	it('gives each request its own copy of a static literal', async () => {
		const literal = { meta: { owner: 'none' }, name: 'bob' }

		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					meta: t.Object({ owner: t.String() }),
					name: t.String()
				}),
				afterHandle({ responseValue, query }) {
					const owner = (query as Record<string, string>).owner
					if (owner) (responseValue as any).meta.owner = owner
				}
			},
			literal as any
		)

		await expect(
			app.handle('/?owner=alice').then((res) => res.json())
		).resolves.toEqual({ meta: { owner: 'alice' }, name: 'bob' })

		// the request that stamps nothing must not inherit alice
		await expect(
			app.handle('/').then((res) => res.json())
		).resolves.toEqual({ meta: { owner: 'none' }, name: 'bob' })

		expect(literal).toEqual({ meta: { owner: 'none' }, name: 'bob' })
	})

	it('gives each request its own copy of a static literal a mapResponse mutates', async () => {
		const literal = { owner: 'none', name: 'bob' }

		const app = new Elysia().get(
			'/',
			{
				response: t.Object({ owner: t.String(), name: t.String() }),
				mapResponse({ responseValue, query }) {
					const owner = (query as Record<string, string>).owner
					if (owner) (responseValue as any).owner = owner
				}
			},
			literal as any
		)

		await expect(
			app.handle('/?owner=alice').then((res) => res.json())
		).resolves.toEqual({ owner: 'alice', name: 'bob' })

		await expect(
			app.handle('/').then((res) => res.json())
		).resolves.toEqual({ owner: 'none', name: 'bob' })

		expect(literal).toEqual({ owner: 'none', name: 'bob' })
	})
})
