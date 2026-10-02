import { Elysia, ElysiaStatus, t, sse } from '../../src'
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
	it.each(['afterHandle', 'mapResponse'] as const)(
		'isolates a static status payload and headers per request through %s',
		async (hook) => {
			const headers = { 'x-owned': 'pristine' }
			const payload = { name: 'intact' }
			const owner = new ElysiaStatus(201, payload, headers)
			const seen: Record<string, string>[] = []
			const app = new Elysia().get(
				'/',
				{
					response: { 201: t.Object({ name: t.String() }) },
					[hook]({ responseValue, query }: any) {
						seen.push(responseValue.headers)
						if (query.stamp) {
							responseValue.response.name = 'stamped'
							responseValue.headers['x-owned'] = 'stamped'
						}
					}
				},
				owner
			)

			const first = await app.handle('/?stamp=1')
			const firstBody = await first.text()
			const second = await app.handle('/')
			const secondBody = await second.text()
			expect([first.status, second.status]).toEqual([201, 201])
			expect([firstBody, secondBody]).toEqual([
				'{"name":"stamped"}',
				'{"name":"intact"}'
			])
			expect(first.headers.get('x-owned')).toBe('stamped')
			expect(second.headers.get('x-owned')).toBe('pristine')
			expect(seen).toHaveLength(2)
			expect(seen[0]).not.toBe(seen[1])
			for (const value of seen) expect(value).not.toBe(headers)
			expect(owner.status).toBe(201)
			expect(owner.response).toBe(payload)
			expect(owner.headers).toBe(headers)
			expect(payload).toEqual({ name: 'intact' })
			expect(headers).toEqual({ 'x-owned': 'pristine' })
		}
	)

	it('validates a static status with its declared status schema', async () => {
		const invalidBody = {
			type: 'internal-server-error',
			code: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'must be string',
			on: 'response',
			property: '/name',
			found: { name: 1 },
			expected: { name: '' },
			errors: [
				{
					keyword: 'type',
					schemaPath: '#/properties/name',
					instancePath: '/name',
					params: { type: 'string' },
					message: 'must be string'
				}
			]
		}
		for (const valid of [true, false]) {
			const results: { status: number; body: string }[][] = []
			for (const kind of ['static', 'function']) {
				const payload = { name: valid ? 'intact' : 1 }
				const value = new ElysiaStatus(201, payload, {
					'x-owned': 'yes'
				})
				const seen: unknown[] = []
				const app = new Elysia({
					allowUnsafeValidationDetails: true
				}).get(
					'/',
					{
						response: { 201: t.Object({ name: t.String() }) },
						afterHandle({ responseValue }) {
							seen.push(responseValue)
						}
					},
					(kind === 'static'
						? value
						: () =>
								new ElysiaStatus(
									201,
									{ ...payload },
									{ 'x-owned': 'yes' }
								)) as any
				)
				const pair = []
				for (let i = 0; i < 2; i++) {
					const response = await app.handle('/')
					const body = await response.text()
					pair.push({ status: response.status, body })
					expect(response.status).toBe(valid ? 201 : 500)
					expect(JSON.parse(body)).toEqual(
						valid ? { name: 'intact' } : invalidBody
					)
					if (valid)
						expect(response.headers.get('x-owned')).toBe('yes')
				}
				expect(seen).toHaveLength(2)
				expect(value.response).toBe(payload)
				expect(payload).toEqual({ name: valid ? 'intact' : 1 })
				results.push(pair)
			}
			expect(results[0]).toEqual(results[1])
		}
	})

	it('preserves the native graph while restoring a static status root', async () => {
		const node = { count: 0 }
		const date = new Date(1234)
		const payload: any = { left: node, right: node, date, dateAgain: date }
		const owner = new ElysiaStatus(201, payload, { 'x-owned': 'yes' })
		const map = new Map<unknown, unknown>([
			[node, date],
			[owner, node],
			['root', owner]
		])
		payload.map = map
		payload.root = owner
		let reads = 0
		Object.defineProperty(payload, 'counted', {
			enumerable: true,
			get() {
				reads++
				return 'fixed'
			}
		})
		const seen: unknown[] = []
		const app = new Elysia().get(
			'/',
			{
				response: { 201: t.Any() },
				afterHandle({ responseValue }) {
					const current = responseValue as any
					const value = current.response
					expect(current).not.toBe(owner)
					expect(seen).not.toContain(current)
					expect(value).not.toBe(current)
					expect(value).not.toBe(payload)
					expect(current.headers).not.toBe(owner.headers)
					expect(value.left).not.toBe(node)
					expect(value.date).not.toBe(date)
					expect(value.map).not.toBe(map)
					expect(value.left).toBe(value.right)
					expect(value.date).toBe(value.dateAgain)
					expect(value.map.get(value.left)).toBe(value.date)
					expect(value.map.get(current)).toBe(value.left)
					expect(value.map.get('root')).toBe(current)
					expect(value.root).toBe(current)
					expect([
						value.left.count,
						value.date.getTime(),
						value.map.size
					]).toEqual([0, 1234, 3])
					expect(value.counted).toBe('fixed')
					seen.push(current)
					expect(reads).toBe(seen.length)
					value.left.count++
					value.date.setTime(5678)
					value.map.set('changed', value.left)
					expect(value.right.count).toBe(1)
					expect(value.dateAgain.getTime()).toBe(5678)
					current.response = {
						count: value.left.count,
						date: value.date.getTime(),
						mapSize: value.map.size
					}
				}
			},
			owner
		)
		expect(reads).toBe(0)
		for (let i = 0; i < 2; i++) {
			const response = await app.handle('/')
			const body = await response.text()
			expect(response.status).toBe(201)
			expect(body).toBe('{"count":1,"date":5678,"mapSize":4}')
			expect(response.headers.get('x-owned')).toBe('yes')
		}
		expect(reads).toBe(2)
		expect([node.count, date.getTime(), map.size]).toEqual([0, 1234, 3])
		expect(owner.response).toBe(payload)
		expect(payload.root).toBe(owner)
		expect(map.get(owner)).toBe(node)
		expect(map.get('root')).toBe(owner)
		expect(map.get(node)).toBe(date)
	})

	it('isolates a static graph without traversing its prototype ancestors', async () => {
		let armed = false
		let armedCalls = 0
		const prototype = new Proxy(
			{},
			{
				getPrototypeOf(target) {
					if (armed) {
						armed = false
						armedCalls++
						throw new Error('Armed prototype traversal')
					}
					return Reflect.getPrototypeOf(target)
				}
			}
		)
		const node = { count: 0 }
		const date = new Date(1234)
		const map = new Map<unknown, unknown>([
			['node', node],
			['date', date]
		])
		const owner = { left: node, right: node, date, dateAgain: date, map }
		Object.setPrototypeOf(owner, prototype)
		const seen: unknown[] = []
		const app = new Elysia({ precompile: true }).get(
			'/',
			{
				response: t.Any(),
				afterHandle({ responseValue }) {
					const value = responseValue as typeof owner
					expect(value).not.toBe(owner)
					expect(seen).not.toContain(value)
					expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
					expect(value.left).not.toBe(node)
					expect(value.date).not.toBe(date)
					expect(value.map).not.toBe(map)
					expect(value.left).toBe(value.right)
					expect(value.date).toBe(value.dateAgain)
					expect(value.map.get('node')).toBe(value.left)
					expect(value.map.get('date')).toBe(value.date)
					expect([
						value.left.count,
						value.date.getTime(),
						value.map.size
					]).toEqual([0, 1234, 2])
					seen.push(value)
					value.left.count++
					value.date.setTime(2234)
					value.map.set('mutation', value.left)
					return {
						count: value.left.count,
						date: value.date.getTime(),
						mapSize: value.map.size
					}
				}
			},
			owner
		)
		app.compile()
		for (let i = 0; i < 2; i++) {
			armed = true
			try {
				const response = await app.handle('/')
				const body = await response.text()
				expect(response.status).toBe(200)
				expect(body).toBe('{"count":1,"date":2234,"mapSize":3}')
			} finally {
				armed = false
			}
		}
		expect(armedCalls).toBe(0)
		expect(seen).toHaveLength(2)
		expect([node.count, date.getTime(), map.size]).toEqual([0, 1234, 2])
		expect(owner.left).toBe(node)
		expect(owner.right).toBe(node)
		expect(owner.date).toBe(date)
		expect(owner.dateAgain).toBe(date)
		expect(owner.map).toBe(map)
		expect(map.get('node')).toBe(node)
		expect(map.get('date')).toBe(date)
		expect(Object.getPrototypeOf(owner)).toBe(prototype)
	})
})
