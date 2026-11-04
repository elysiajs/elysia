import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { Elysia, sse, status, t } from '../../src'
import { trace } from '../../src/plugin/trace'

/**
 * `response` filters what a route sends. A generator's chunks go through the
 * same filter, so a field a schema leaves out can't reach the client just
 * because the route streams. Nothing is validated, but what can't be stripped
 * is not sent either: Clean throwing errors the stream.
 */

const get = (
	app: { handle(request: Request): Promise<Response> },
	path = '/'
) => app.handle(new Request(`http://localhost${path}`))

const body = (app: Parameters<typeof get>[0], path?: string) =>
	get(app, path).then((response) => response.text())

// what the client got and how the stream ended; a hang fails on the test timeout
const read = async (app: Parameters<typeof get>[0], path?: string) => {
	const reader = (await get(app, path)).body!.getReader()
	const decoder = new TextDecoder()
	let text = ''

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) return { text, error: undefined }

			text += decoder.decode(value)
		}
	} catch (error) {
		return { text, error }
	}
}

const object = t.Object({ a: t.Number() })

// chunk shapes `response` is typed against, not what these tests yield
const yields = (...chunks: unknown[]) =>
	function* () {
		yield* chunks
	} as () => Generator<any>

const stream = (schema: any, ...chunks: unknown[]) =>
	new Elysia().get('/', { response: schema }, yields(...chunks))

describe('generator chunks follow the response schema', () => {
	it('strips an unknown field from the first and the later chunks', async () => {
		const secret = (a: number) => ({ a, secret: 'x' })

		const sync = new Elysia().get(
			'/',
			{ response: object },
			function* (): Generator<any> {
				yield secret(1)
				yield secret(2)
				yield secret(3)
			}
		)

		const asynchronous = new Elysia().get(
			'/',
			{ response: object },
			async function* (): AsyncGenerator<any> {
				yield secret(1)
				await Bun.sleep(1)
				yield secret(2)
				yield secret(3)
			}
		)

		expect(await body(sync)).toBe('{"a":1}{"a":2}{"a":3}')
		expect(await body(asynchronous)).toBe('{"a":1}{"a":2}{"a":3}')
	})

	it('strips nested fields and array items as a returned value does', async () => {
		const schema = t.Object({
			user: t.Object({ name: t.String() }),
			tags: t.Array(t.Object({ id: t.Number() }))
		})
		const chunk = {
			user: { name: 'a', password: 'x' },
			tags: [{ id: 1, internal: true }],
			secret: 'x'
		}

		const returned = new Elysia().get('/', { response: schema }, () => ({
			...chunk
		}))

		expect(await body(stream(schema, chunk))).toBe(await body(returned))
		expect(await body(stream(schema, chunk))).toBe(
			'{"user":{"name":"a"},"tags":[{"id":1}]}'
		)
	})

	it('strips a chunk of a root array schema', async () => {
		expect(
			await body(stream(t.Array(object), [{ a: 1, secret: 'x' }]))
		).toBe('[{"a":1}]')
	})

	it('strips a class instance, which a returned value also loses fields of', async () => {
		class User {
			a = 1
			secret = 'x'
		}

		expect(await body(stream(object, new User()))).toBe('{"a":1}')
	})

	it('strips a generator returned from an async handler', async () => {
		const app = new Elysia().get('/', { response: object }, async () =>
			yields({ a: 1, secret: 'x' })()
		)

		expect(await body(app)).toBe('{"a":1}')
	})

	it('strips a generator a lifecycle hook answers with', async () => {
		const generator = yields({ a: 1, secret: 'x' })

		const before = new Elysia().get(
			'/',
			{ response: object, beforeHandle: () => generator() as any },
			() => ({ a: 2 })
		)
		const mapped = new Elysia().get(
			'/',
			{ response: object, mapResponse: () => generator() as any },
			() => ({ a: 2 })
		)

		expect(await body(before)).toBe('{"a":1}')
		expect(await body(mapped)).toBe('{"a":1}')
	})

	it('strips under default headers, which give a route another set', async () => {
		const app = new Elysia()
			.headers({ 'x-powered-by': 'Elysia' })
			.get('/', { response: object }, yields({ a: 1, secret: 'x' }))

		const response = await get(app)

		expect(response.headers.get('x-powered-by')).toBe('Elysia')
		expect(await response.text()).toBe('{"a":1}')
	})

	it('keeps a route without a response schema as it was', async () => {
		const app = new Elysia().get('/', yields({ a: 1, secret: 'x' }))

		expect(await body(app)).toBe('{"a":1,"secret":"x"}')
	})

	it('does not reach a set of a response that is not a generator', async () => {
		let seen: object | undefined

		const app = new Elysia().get(
			'/',
			{
				response: object,
				afterResponse: ({ set }) => {
					seen = set
				}
			},
			() => ({ a: 1 })
		)

		await body(app)
		expect(seen).toBeDefined()
		expect('~chunk' in seen!).toBe(false)
	})
})

describe('the schema of a chunk is the schema of its status', () => {
	const schemas = {
		200: object,
		201: t.Object({ b: t.Number() })
	}

	it('picks the entry of the default status', async () => {
		expect(await body(stream(schemas, { a: 1, b: 2 }))).toBe('{"a":1}')
	})

	it('picks the entry of the status set by the generator before it yields', async () => {
		const app = new Elysia().get(
			'/',
			{ response: schemas },
			function* ({ set }): Generator<any> {
				set.status = 201
				yield { a: 1, b: 2 }
				yield { a: 3, b: 4 }
			}
		)

		const response = await get(app)

		expect(response.status).toBe(201)
		expect(await response.text()).toBe('{"b":2}{"b":4}')
	})

	it('picks the entry of a named status', async () => {
		const app = new Elysia().get(
			'/',
			{ response: schemas },
			function* ({ set }): Generator<any> {
				set.status = 'Created'
				yield { a: 1, b: 2 }
			}
		)

		const response = await get(app)

		expect(response.status).toBe(201)
		expect(await response.text()).toBe('{"b":2}')
	})

	it('picks the entry of a status set before the handler returned', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: schemas,
				beforeHandle: ({ set }) => {
					set.status = 201
				}
			},
			yields({ a: 1, b: 2 })
		)

		expect(await body(app)).toBe('{"b":2}')
	})

	// validating the generator object itself failed this route with a 500
	it('picks the entry of status() around a generator', async () => {
		const app = new Elysia().get(
			'/',
			{ response: schemas },
			() => status(201, yields({ a: 1, b: 2 })() as any) as any
		)

		const response = await get(app)

		expect(response.status).toBe(201)
		expect(await response.text()).toBe('{"b":2}')
	})

	it('passes chunks through when no schema applies to the status', async () => {
		const app = new Elysia().get(
			'/',
			{ response: { 201: object } },
			yields({ a: 1, secret: 'x' })
		)

		const wrapped = new Elysia().get(
			'/',
			{ response: { 201: object } },
			() => status(202, yields({ a: 1, secret: 'x' })() as any) as any
		)

		expect(await body(app)).toBe('{"a":1,"secret":"x"}')
		expect(await body(wrapped)).toBe('{"a":1,"secret":"x"}')
	})

	it('leaves the stream of an error hook to that hook', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: { 500: object },
				error: yields({ a: 1, detail: 'kept' }) as any
			},
			function* (): Generator<any> {
				throw new Error('before the first chunk')
			}
		)

		expect(await body(app)).toBe('{"a":1,"detail":"kept"}')
	})
})

describe('sse() chunks are cleaned without losing their framing', () => {
	const schema = t.Object({ data: t.Object({ name: t.String() }) })

	it('cleans the data of the payload the schema describes', async () => {
		const app = stream(
			schema,
			sse({
				event: 'tick',
				id: 7,
				retry: 1000,
				data: { name: 'a', secret: 'x' }
			})
		)

		const response = await get(app)

		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(await response.text()).toBe(
			'id: 7\nevent: tick\nretry: 1000\ndata: {"name":"a"}\n\n'
		)
	})

	it('keeps a field the schema names and strips under it', async () => {
		const app = stream(
			t.Object({
				event: t.String(),
				data: t.Object({ name: t.String() })
			}),
			sse({ event: 'tick', data: { name: 'a', secret: 'x' } })
		)

		expect(await body(app)).toBe('event: tick\ndata: {"name":"a"}\n\n')
	})

	it('cleans every chunk of an async generator', async () => {
		const app = new Elysia().get(
			'/',
			{ response: schema },
			async function* (): AsyncGenerator<any> {
				yield sse({ data: { name: 'a', secret: 'x' } })
				await Bun.sleep(1)
				yield sse({ data: { name: 'b', secret: 'x' } })
			}
		)

		expect(await body(app)).toBe(
			'data: {"name":"a"}\n\ndata: {"name":"b"}\n\n'
		)
	})

	it('cleans sse and plain chunks of one stream', async () => {
		const framed = sse({ event: 'e', data: { name: 'a', secret: 'x' } })
		const plain = { data: { name: 'b', secret: 'x' } }

		expect(await body(stream(schema, framed, plain, framed))).toBe(
			'event: e\ndata: {"name":"a"}\n\n' +
				'data: {"data":{"name":"b"}}\n\n' +
				'event: e\ndata: {"name":"a"}\n\n'
		)

		expect(await body(stream(schema, plain, framed))).toBe(
			'{"data":{"name":"b"}}event: e\ndata: {"name":"a"}\n\n'
		)
	})

	it('leaves the payload a generator still holds alone', async () => {
		const data = { name: 'a', secret: 'x' }
		const payload = sse({ event: 'e', data })

		await body(stream(schema, payload))

		expect(payload.data).toBe(data)
		expect(payload.data.secret).toBe('x')
		expect(payload.event).toBe('e')
	})

	it('sends only the data the schema kept', async () => {
		const secret = { data: { name: 'a', secret: 'x' } }

		// a schema without `data`, and one that describes the data itself
		expect(
			await body(
				stream(
					t.Object({ event: t.String() }),
					sse({ event: 'e', ...secret })
				)
			)
		).toBe('event: e\n\n')

		expect(
			await body(
				stream(
					t.Object({ name: t.String() }),
					sse({ event: 'e', ...secret })
				)
			)
		).toBe('event: e\n\n')

		expect(await body(stream(schema, sse('text')))).toBe('data: {}\n\n')
	})

	it('errors on an sse chunk Clean can not read', async () => {
		const { text, error } = await read(
			stream(
				schema,
				sse({ data: { name: 'a', secret: 'x' } }),
				sse({ event: 'ping' })
			)
		)

		expect(text).toBe('data: {"name":"a"}\n\n')
		expect(error).toBeInstanceOf(TypeError)
	})

	it('keeps the framing when TypeBox Clean deletes in place', async () => {
		const app = new Elysia({ normalize: 'typebox' }).get(
			'/',
			{ response: schema },
			yields(sse({ event: 'e', id: 1, data: { name: 'a', secret: 'x' } }))
		)

		expect(await body(app)).toBe('id: 1\nevent: e\ndata: {"name":"a"}\n\n')
	})

	it('keeps the framing under a Zod schema', async () => {
		const app = stream(
			z.object({ data: z.object({ name: z.string() }) }),
			sse({ event: 'e', id: 1, data: { name: 'a', secret: 'x' } })
		)

		expect(await body(app)).toBe('id: 1\nevent: e\ndata: {"name":"a"}\n\n')
	})
})

describe('a plain chunk of sse(generator) is the data of its event', () => {
	const schema = t.Object({ data: t.Object({ name: t.String() }) })
	const chunk = (name: string) => ({ name, secret: 'x' })

	const framed = (
		response: any,
		generator: () => Generator<any> | AsyncGenerator<any>,
		hook?: Record<string, unknown>
	) =>
		new Elysia().get('/', { response, ...hook }, () =>
			sse(generator() as Generator<any>)
		)

	it('cleans the data of an envelope schema', async () => {
		const generator = function* () {
			yield chunk('a')
			yield chunk('b')
		}

		const response = await get(framed(schema, generator))

		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(await response.text()).toBe(
			'data: {"name":"a"}\n\ndata: {"name":"b"}\n\n'
		)
	})

	it('cleans the data of an async generator', async () => {
		const app = framed(schema, async function* () {
			yield chunk('a')
			await Bun.sleep(1)
			yield chunk('b')
		})

		expect(await body(app)).toBe(
			'data: {"name":"a"}\n\ndata: {"name":"b"}\n\n'
		)
	})

	it('keeps the existing path of a chunk already in sse()', async () => {
		const app = framed(schema, function* () {
			yield sse({ event: 'e', id: 1, data: chunk('a') })
			yield chunk('b')
		})

		expect(await body(app)).toBe(
			'id: 1\nevent: e\ndata: {"name":"a"}\n\ndata: {"name":"b"}\n\n'
		)
	})

	it('cleans under status()', async () => {
		const app = new Elysia().get(
			'/',
			{ response: { 201: schema } },
			() =>
				status(
					201,
					sse(
						(function* () {
							yield chunk('a')
						})()
					) as any
				) as any
		)

		const response = await get(app)

		expect(response.status).toBe(201)
		expect(await response.text()).toBe('data: {"name":"a"}\n\n')
	})

	it('sanitizes a string chunk', async () => {
		const app = new Elysia({
			sanitize: (value) => value.replaceAll('<', '&lt;')
		}).get('/', { response: t.Object({ data: t.String() }) }, () =>
			sse(
				(function* () {
					yield '<b>'
				})()
			)
		)

		expect(await body(app)).toBe('data: &lt;b>\n\n')
	})

	it('cleans under a Zod schema, an invalid chunk staying as it came', async () => {
		const app = framed(
			z.object({ data: z.object({ name: z.string() }) }),
			function* () {
				yield chunk('a')
				yield { name: 1, kept: 'x' }
			}
		)

		expect(await body(app)).toBe(
			'data: {"name":"a"}\n\ndata: {"name":1,"kept":"x"}\n\n'
		)
	})

	// the tee hands the stream handler a branch: it has to stay an event stream
	it('stays an event stream through afterResponse and trace', async () => {
		const generator = async function* () {
			yield chunk('a')
			yield chunk('b')
		}
		const expected = 'data: {"name":"a"}\n\ndata: {"name":"b"}\n\n'

		for (const app of [
			framed(schema, generator, { afterResponse() {} }),
			framed(schema, generator, { afterResponse: async () => {} }),
			new Elysia()
				.use(trace())
				.trace(({ onHandle }) => {
					onHandle(({ onStop }) => onStop(() => {}))
				})
				.get('/', { response: schema }, () => sse(generator()))
		]) {
			const response = await get(app)

			expect(response.headers.get('content-type')).toBe(
				'text/event-stream'
			)
			expect(await response.text()).toBe(expected)
		}
	})

	it('errors rather than send a chunk the schema has no data for', async () => {
		const { text, error } = await read(
			framed(t.Object({ name: t.String() }), function* () {
				yield chunk('a')
			})
		)

		expect(text).toBe('')
		expect(error).toBeInstanceOf(TypeError)
	})
})

describe('a chunk without fields goes out as it came', () => {
	it('sends string and bytes chunks under an object schema', async () => {
		const bytes = new Uint8Array([104, 105])

		expect(await body(stream(object, 'hello', { a: 1, s: 1 }))).toBe(
			'hello{"a":1}'
		)

		const response = await get(stream(object, bytes, { a: 1, s: 1 }))

		expect(response.headers.get('content-type')).toBe(
			'application/octet-stream'
		)
		expect(await response.text()).toBe('hi{"a":1}')
	})

	it('sends every other kind of value under an object schema', async () => {
		expect(
			await body(
				stream(
					object,
					new Uint8Array([104]).buffer,
					new Blob(['b']),
					7,
					true,
					new Date(0)
				)
			)
		).toBe('hb7true"1970-01-01T00:00:00.000Z"')
	})

	it('sends a promise a sync generator yields without waiting for it', async () => {
		expect(await body(stream(object, Promise.resolve({ a: 1 })))).toBe('{}')
	})

	it('does not rebuild it under an optional, an array or a record', async () => {
		// all optional: a mirror would turn these into `{}` without complaint
		expect(
			await body(
				stream(
					t.Object({ a: t.Optional(t.Number()) }),
					new Date(0),
					'text'
				)
			)
		).toBe('"1970-01-01T00:00:00.000Z"text')
		expect(await body(stream(t.Array(object), 'hello'))).toBe('hello')
		expect(await body(stream(t.Record(t.String(), object), 'hello'))).toBe(
			'hello'
		)
	})

	it('counts an intersect as an object', async () => {
		const intersect = t.Intersect([object, t.Object({ b: t.String() })])

		expect(
			await body(
				stream(intersect, 'hello', { a: 1, b: 'q', secret: 'x' })
			)
		).toBe('hello{"a":1,"b":"q"}')
	})
})

// these used to be the leak: a chunk the schema doesn't fit still has fields
describe('a chunk with fields is stripped even if the schema does not fit', () => {
	it('strips a chunk missing a required field', async () => {
		expect(
			await body(stream(object, { b: 1, secret: 'x' }, { a: 1, s: 1 }))
		).toBe('{}{"a":1}')
	})

	it('strips around a wrong leaf, which Clean never touches', async () => {
		expect(await body(stream(object, { a: 'text', secret: 'x' }))).toBe(
			'{"a":"text"}'
		)
	})

	it('strips a chunk in the wrong container', async () => {
		expect(await body(stream(t.Array(object), { secret: 'x' }))).toBe(
			'[null]'
		)
		expect(await body(stream(object, [{ a: 1, secret: 'x' }]))).toBe('{}')
	})

	it('strips a nested value of the wrong kind', async () => {
		const nested = t.Object({ a: t.Object({ y: t.String() }) })

		expect(await body(stream(nested, { a: 'text', secret: 'x' }))).toBe(
			'{"a":{}}'
		)
	})

	it('strips inside a tuple, a record and an intersect', async () => {
		const item = t.Object({ y: t.String() })

		expect(
			await body(
				stream(t.Tuple([item, t.String()]), [{ y: 'q', s: 1 }, 'x'])
			)
		).toBe('[{"y":"q"},"x"]')

		expect(
			await body(
				stream(t.Record(t.String(), item), {
					k: { y: 'q', secret: 'x' },
					text: 'kept by the record'
				})
			)
		).toBe('{"k":{"y":"q"},"text":{}}')

		expect(
			await body(
				stream(t.Intersect([object, t.Object({ b: t.String() })]), {
					a: 1,
					secret: 'x'
				})
			)
		).toBe('{"a":1}')
	})

	it('cleans the union member that matches', async () => {
		const union = t.Union([object, t.String()])

		expect(await body(stream(union, { a: 1, s: 1 }, 'text'))).toBe(
			'{"a":1}text'
		)
	})
})

describe('a chunk Clean can not strip errors the stream', () => {
	const nested = t.Object({ a: t.Object({ y: t.String() }) })
	const good = { a: { y: 'q', secret: 'x' } }
	const bad = { a: null, secret: 'x' }

	const sanitized = (build: () => Generator<any> | AsyncGenerator<any>) =>
		new Elysia({
			sanitize: (value) => value.replaceAll('<', '&lt;')
		}).get(
			'/',
			{ response: t.Object({ name: t.String() }) },
			build as () => Generator<any>
		)

	it('on the first chunk, which is pulled before the Response is made', async () => {
		const { text, error } = await read(stream(nested, bad, good))

		expect(text).toBe('')
		expect(error).toBeInstanceOf(TypeError)
	})

	it('on a later chunk, after what was already sent', async () => {
		const { text, error } = await read(stream(nested, good, bad, good))

		expect(text).toBe('{"a":{"y":"q"}}')
		expect(error).toBeInstanceOf(TypeError)
	})

	it('on either chunk of an async generator', async () => {
		const app = (...chunks: unknown[]) =>
			new Elysia().get(
				'/',
				{ response: nested },
				async function* (): AsyncGenerator<any> {
					for (const chunk of chunks) {
						await Bun.sleep(1)
						yield chunk
					}
				}
			)

		const first = await read(app(bad))
		const later = await read(app(good, bad))

		expect(first.text).toBe('')
		expect(first.error).toBeInstanceOf(TypeError)
		expect(later.text).toBe('{"a":{"y":"q"}}')
		expect(later.error).toBeInstanceOf(TypeError)
	})

	it('when a sanitizer throws, on the first and a later chunk', async () => {
		const first = await read(
			sanitized(function* () {
				yield { name: 1, secret: 'x' }
			})
		)
		const later = await read(
			sanitized(async function* () {
				yield { name: '<b>' }
				yield { name: 1, secret: 'x' }
			})
		)

		expect(first.text).toBe('')
		expect(first.error).toBeInstanceOf(TypeError)
		expect(later.text).toBe('{"name":"&lt;b>"}')
		expect(later.error).toBeInstanceOf(TypeError)
	})

	it('ends the same way as a generator that throws', async () => {
		const thrown = await read(
			new Elysia().get(
				'/',
				{ response: nested },
				function* (): Generator<any> {
					yield good
					throw new Error('generator')
				}
			)
		)
		const cleaned = await read(stream(nested, good, bad))

		expect(cleaned.text).toBe(thrown.text)
		expect(thrown.error).toBeInstanceOf(Error)
		expect(cleaned.error).toBeInstanceOf(Error)
	})

	for (const [where, chunks, sent] of [
		['first', [bad, good], ''],
		['later', [good, bad, good], '{"a":{"y":"q"}}']
	] as const)
		for (const kind of ['sync', 'async'])
			it(`runs finally, afterResponse and trace once on the ${where} chunk of a ${kind} generator`, async () => {
				const events: string[] = []

				const body = function (this: void) {
					const run = function* () {
						try {
							yield* chunks
						} finally {
							events.push('finally')
						}
					}

					if (kind === 'sync') return run()

					return (async function* () {
						yield* run()
					})()
				}

				const app = new Elysia()
					.use(trace())
					.trace(({ onHandle }) => {
						onHandle(({ onStop }) =>
							onStop(() => events.push('trace'))
						)
					})
					.onAfterResponse(() => {
						events.push('afterResponse')
					})
					.get('/', { response: nested }, body as any)

				const { text, error } = await read(app)
				await Bun.sleep(5)

				expect(text).toBe(sent)
				expect(error).toBeInstanceOf(TypeError)
				expect(events.sort()).toEqual([
					'afterResponse',
					'finally',
					'trace'
				])
			})

	it('runs finally and afterResponse once without a trace', async () => {
		const events: string[] = []

		const app = new Elysia().get(
			'/',
			{
				response: nested,
				afterResponse() {
					events.push('afterResponse')
				}
			},
			function* (): Generator<any> {
				try {
					yield bad
				} finally {
					events.push('finally')
				}
			}
		)

		const { error } = await read(app)
		await Bun.sleep(5)

		expect(error).toBeInstanceOf(TypeError)
		expect(events.sort()).toEqual(['afterResponse', 'finally'])
	})

	// how the connection ends after bytes went out is the runtime's: on Bun a
	// failed sync stream can read as finished, a throwing generator included
	it('sends a real client nothing of the chunk, without hanging', async () => {
		const app = new Elysia()
			.get('/first', { response: nested }, function* (): Generator<any> {
				yield bad
			})
			.get('/later', { response: nested }, function* (): Generator<any> {
				yield good
				yield bad
			})
			.listen(0)

		const received = async (path: string) => {
			const decoder = new TextDecoder()
			let text = ''

			try {
				const response = await fetch(
					`http://localhost:${app.server!.port}${path}`
				)

				for await (const chunk of response.body as any)
					text += decoder.decode(chunk)
			} catch {}

			return text
		}

		try {
			expect(await received('/first')).toBe('')
			expect(await received('/later')).toBe('{"a":{"y":"q"}}')
		} finally {
			await app.stop(true)
		}
	})
})

describe('a Standard Schema cleans by parsing', () => {
	const schema = z.object({ a: z.number() })

	it('strips what the schema strips on a returned value', async () => {
		expect(await body(stream(schema, { a: 1, secret: 'x' }))).toBe(
			'{"a":1}'
		)
	})

	it('leaves an invalid chunk and carries on', async () => {
		expect(
			await body(stream(schema, { a: 'text' }, 'text', { a: 1, s: 1 }))
		).toBe('{"a":"text"}text{"a":1}')
	})

	it('survives a refinement that throws', async () => {
		const refined = z.object({ a: z.number() }).refine(() => {
			throw new Error('refinement')
		})

		expect(await body(stream(refined, { a: 1 }, { a: 2 }))).toBe(
			'{"a":1}{"a":2}'
		)
	})

	it('waits for an async schema in chunk order, from a sync generator', async () => {
		const later = z.object({ a: z.number() }).refine(async () => {
			await Bun.sleep(1)
			return true
		})

		expect(
			await body(stream(later, { a: 1, s: 1 }, 'text', { a: 2, s: 1 }))
		).toBe('{"a":1}text{"a":2}')
	})

	it('leaves an async rejection intact', async () => {
		const rejected = z.object({ a: z.number() }).refine(async () => false)

		expect(await body(stream(rejected, { a: 1, kept: 'x' }))).toBe(
			'{"a":1,"kept":"x"}'
		)
	})

	it('cleans through a guard merged with a Standard Schema', async () => {
		const app = new Elysia()
			.guard({ response: t.Object({ b: t.Number() }) })
			.get('/', { response: schema }, yields({ a: 1, b: 2, secret: 'x' }))

		expect(await body(app)).not.toContain('secret')
	})
})

describe('a chunk is cleaned the way the app configures Clean', () => {
	it('sanitizes the strings of a chunk', async () => {
		const app = new Elysia({
			sanitize: (value) => value.replaceAll('<', '&lt;')
		}).get(
			'/',
			{ response: t.Object({ name: t.String() }) },
			yields({ name: '<b>', secret: '<i>' }, { name: '<u>' })
		)

		expect(await body(app)).toBe('{"name":"&lt;b>"}{"name":"&lt;u>"}')
	})

	it('sanitizes the data of an sse chunk', async () => {
		const app = new Elysia({
			sanitize: (value) => value.replaceAll('<', '&lt;')
		}).get(
			'/',
			{ response: t.Object({ data: t.String() }) },
			yields(sse({ event: 'e', data: '<b>' }))
		)

		expect(await body(app)).toBe('event: e\ndata: &lt;b>\n\n')
	})

	it('sanitizes a root string chunk', async () => {
		const app = new Elysia({
			sanitize: (value) => value.replaceAll('<', '&lt;')
		}).get('/', { response: t.String() }, yields('<b>'))

		expect(await body(app)).toBe('&lt;b>')
	})

	it('cleans nothing with normalize: false', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			{
				response: t.Object({
					a: t.Number(),
					b: t.String({ default: 'added' })
				})
			},
			yields({ a: 1, kept: 'x' }, { a: 1 })
		)

		expect(await body(app)).toBe('{"a":1,"kept":"x"}{"a":1}')
	})

	it('cleans with normalize: typebox, which can not take bytes', async () => {
		const app = new Elysia({ normalize: 'typebox' }).get(
			'/',
			{ response: object },
			yields({ a: 1, secret: 'x' }, new Uint8Array([104]), {
				b: 1,
				secret: 'x'
			})
		)

		expect(await body(app)).toBe('{"a":1}h{}')
	})

	// a closed object rejects unknown fields in Check: without one, only Clean
	// keeps them out
	it('cleans a closed object, whose Clean is otherwise redundant', async () => {
		const closed = t.Object(
			{ a: t.Number() },
			{ additionalProperties: false }
		)

		expect(await body(stream(closed, { a: 1, secret: 'x' }))).toBe(
			'{"a":1}'
		)
	})

	it('cleans a model by name', async () => {
		const app = new Elysia()
			.model({ item: object })
			.get('/', { response: 'item' }, yields({ a: 1, secret: 'x' }))

		expect(await body(app)).toBe('{"a":1}')
	})
})

describe('cleaning stays out of the stream lifecycle', () => {
	it('sends a generator return value as it did', async () => {
		const returned = new Elysia().get(
			'/',
			{ response: object },
			function* (): Generator<any, any> {
				return { a: 1, secret: 'kept' }
			}
		)

		const afterYield = new Elysia().get(
			'/',
			{ response: object },
			function* (): Generator<any, any> {
				yield { a: 1, secret: 'x' }
				return { a: 2, secret: 'dropped' }
			}
		)

		expect(await body(returned)).toBe('{"a":1,"secret":"kept"}')
		expect(await body(afterYield)).toBe('{"a":1}')
	})

	it('runs finally and return() when the client cancels', async () => {
		const events: string[] = []

		const app = new Elysia().get(
			'/',
			{ response: object },
			async function* (): AsyncGenerator<any> {
				try {
					yield { a: 1, secret: 'x' }
					yield { a: 2, secret: 'x' }
					await Bun.sleep(1000)
					yield { a: 3, secret: 'x' }
				} finally {
					events.push('finally')
				}
			}
		)

		const response = await get(app)
		const reader = response.body!.getReader()
		const { value } = await reader.read()

		expect(new TextDecoder().decode(value)).toBe('{"a":1}')

		await reader.cancel()
		await Bun.sleep(5)

		expect(events).toEqual(['finally'])
	})

	it('calls return() on the iterator a route hands over', async () => {
		let returned = 0

		const iterator = {
			next: () => ({ done: false, value: { a: 1, secret: 'x' } }),
			return() {
				returned++

				return { done: true, value: undefined }
			},
			[Symbol.iterator]() {
				return this
			}
		}

		const app = new Elysia().get(
			'/',
			{ response: object },
			() => iterator as any
		)

		const response = await get(app)
		const reader = response.body!.getReader()

		await reader.read()
		await reader.cancel()

		expect(returned).toBe(1)
	})

	it('stops the generator when the request aborts', async () => {
		const events: string[] = []
		const controller = new AbortController()

		const app = new Elysia().get(
			'/',
			{ response: object },
			async function* (): AsyncGenerator<any> {
				try {
					yield { a: 1, secret: 'x' }
					yield { a: 2, secret: 'x' }
					await Bun.sleep(1000)
					yield { a: 3, secret: 'x' }
				} finally {
					events.push('finally')
				}
			}
		)

		const response = await app.handle(
			new Request('http://localhost/', { signal: controller.signal })
		)
		const reader = response.body!.getReader()

		await reader.read()
		controller.abort()
		await Bun.sleep(5)

		expect(events).toEqual(['finally'])
	})

	it('errors the stream when the generator throws after a chunk', async () => {
		const app = new Elysia().get(
			'/',
			{ response: object },
			function* (): Generator<any> {
				yield { a: 1, secret: 'x' }
				throw new Error('later')
			}
		)

		const response = await get(app)
		const reader = response.body!.getReader()
		const { value } = await reader.read()

		expect(new TextDecoder().decode(value)).toBe('{"a":1}')
		await expect(reader.read()).rejects.toThrow('later')
	})

	it('fires afterResponse and trace once, after the last cleaned chunk', async () => {
		const events: string[] = []

		const app = new Elysia()
			.use(trace())
			.trace(({ onHandle }) => {
				onHandle(({ onStop }) => onStop(() => events.push('trace')))
			})
			.onAfterResponse(() => {
				events.push('afterResponse')
			})
			.get(
				'/',
				{ response: object },
				async function* (): AsyncGenerator<any> {
					yield { a: 1, secret: 'x' }
					yield { a: 2, secret: 'x' }
					events.push('end')
				}
			)

		expect(await body(app)).toBe('{"a":1}{"a":2}')
		await Bun.sleep(5)

		expect(events.sort()).toEqual(['afterResponse', 'end', 'trace'])
	})

	it('cleans past the tee window of 64 chunks', async () => {
		const app = new Elysia()
			.onAfterResponse(() => {})
			.get(
				'/',
				{ response: object },
				async function* (): AsyncGenerator<any> {
					for (let a = 0; a < 200; a++) yield { a, secret: 'x' }
				}
			)

		const text = await body(app)

		expect(text).not.toContain('secret')
		expect(text.endsWith('{"a":199}')).toBe(true)
		expect(text.match(/"a"/g)).toHaveLength(200)
	})

	it('leaves the chunks an afterHandle hook reads to that hook', async () => {
		let raw: unknown

		const app = new Elysia().get(
			'/',
			{
				response: object,
				afterHandle: async ({ responseValue }) => {
					const generator = responseValue as Generator<any>
					raw = generator.next().value

					return (function* () {
						yield { a: 2, secret: 'x' }
					})() as any
				}
			},
			yields({ a: 1, secret: 'raw' })
		)

		expect(await body(app)).toBe('{"a":2}')
		expect(raw).toEqual({ a: 1, secret: 'raw' })
	})
})

// chunks of a stream are usually bytes: only a generator is a list of values
describe('out of scope stays as it was', () => {
	it('leaves a returned ReadableStream', async () => {
		const app = new Elysia().get(
			'/',
			{ response: object },
			() =>
				new ReadableStream({
					start(controller) {
						controller.enqueue('{"a":1,"secret":"x"}')
						controller.close()
					}
				}) as any
		)

		expect(await body(app)).toBe('{"a":1,"secret":"x"}')
	})

	it('leaves a ReadableStream a generator yields first', async () => {
		const app = new Elysia().get(
			'/',
			{ response: object },
			async function* (): AsyncGenerator<any> {
				yield new ReadableStream({
					start(controller) {
						controller.enqueue({ a: 1, secret: 'x' })
						controller.close()
					}
				})
			}
		)

		expect(await body(app)).toBe('{"a":1,"secret":"x"}')
	})

	it('leaves a generator inside a Response', async () => {
		const app = new Elysia().get(
			'/',
			{ response: object },
			() =>
				new Response(
					(async function* () {
						yield '{"a":1,"secret":"x"}'
					})() as any
				) as any
		)

		expect(await body(app)).toBe('{"a":1,"secret":"x"}')
	})
})
