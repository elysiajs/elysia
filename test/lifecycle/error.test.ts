/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	Elysia,
	InternalServerError,
	InvalidCookie,
	NotFound,
	ParseError,
	ValidationError,
	t,
	validationDetail
} from '../../src'
import { describe, expect, it, spyOn } from 'bun:test'
import { post, json } from '../utils'
import * as z from 'zod'

import { MAX_ERRORS } from '../../src/error'

import { TypeBoxValidator } from '../../src/type/validator'

describe('Error lifecycle', () => {
	it('use custom 404', async () => {
		const app = new Elysia()
			.get('/', () => 'hello')
			.error(({ error, set }) => {
				if (error instanceof NotFound) {
					set.status = 404

					return 'UwU'
				}
			})

		const root = await app.handle('/').then((x) => x.text())
		const notFound = await app.handle('/not/found').then((x) => x.text())

		expect(root).toBe('hello')
		expect(notFound).toBe('UwU')
	})

	it('handle parse error', async () => {
		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ParseError) return 'Why you no proper type'
			})
			.post('/', () => {
				throw new ParseError()
			})

		const root = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: 'A',
				headers: {
					'content-type': 'application/json'
				}
			})
		)

		await expect(root.text()).resolves.toBe('Why you no proper type')
		expect(root.status).toBe(400)
	})

	it('custom validation error', async () => {
		const app = new Elysia()
			.error(({ error, set }) => {
				if (error instanceof ValidationError) {
					set.status = 400

					return error.all.map((i) =>
						i.message
							? {
									filed: i.path.slice(1) || 'root',
									reason: i.message
								}
							: {}
					)
				}
			})
			.post(
				'/login',
				{
					body: t.Object({
						username: t.String(),
						password: t.String()
					})
				},
				({ body }) => body
			)

		const res = await app.handle('/login', json({}))
		const data = await res.json()

		expect(data).toBeArray()
		expect(res.status).toBe(400)
	})

	it('inherits plugin', async () => {
		const plugin = new Elysia().error('global', () => 'hi')

		const app = new Elysia().use(plugin).get('/', () => {
			throw new Error('')
		})

		const res = await app.handle('/').then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('not inherits plugin on local', async () => {
		const plugin = new Elysia().error(() => 'hi')

		const app = new Elysia().use(plugin).get('/', () => {
			throw new Error('')
		})

		const res = await app.handle('/').then((t) => t.text())
		expect(res).not.toBe('hi')
	})

	it('custom 500', async () => {
		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof InternalServerError) {
					return 'UwU'
				}
			})
			.get('/', () => {
				throw new InternalServerError()
			})

		const response = await app.handle('/')

		await expect(response.text()).resolves.toBe('UwU')
		expect(response.status).toBe(500)
	})

	it('defaults set.status = 200 in an error handler to HTTP 500', async () => {
		const app = new Elysia()
			.error(({ set }) => {
				set.status = 200

				return 'recovered?'
			})
			.get('/', () => {
				throw new Error('boom')
			})

		const response = await app.handle('/')

		await expect(response.text()).resolves.toBe('recovered?')
		expect(response.status).toBe(500)
	})

	it('respects an explicit status() recovery from an error handler', async () => {
		const app = new Elysia()
			.error(({ status }) => status(200, 'recovered'))
			.get('/', () => {
				throw new Error('boom')
			})

		const response = await app.handle('/')

		await expect(response.text()).resolves.toBe('recovered')
		expect(response.status).toBe(200)
	})

	it('maps a numeric status code with a response value', async () => {
		const app = new Elysia().get('/', ({ status }) =>
			status(418, 'I am a teapot')
		)

		const response = await app.handle('/')

		expect(response.status).toBe(418)
	})

	it('maps a named status code with a response value', async () => {
		const app = new Elysia().get('/', ({ status }) =>
			status("I'm a teapot", 'I am a teapot')
		)

		const response = await app.handle('/')

		expect(response.status).toBe(418)
	})

	it('uses the default body for a numeric status code', async () => {
		const app = new Elysia().get('/', ({ status }) => status(418))

		const response = await app.handle('/')

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe("I'm a teapot")
	})

	it('uses the default body for a named status code', async () => {
		const app = new Elysia().get('/', ({ status }) =>
			status("I'm a teapot")
		)

		const response = await app.handle('/')

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe("I'm a teapot")
	})

	it('handle error in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.error(() => {
				order.push('A')
			})
			.error(() => {
				order.push('B')
			})
			.get('/', () => {
				throw new Error('A')
			})

		await app.handle('/')

		expect(order).toEqual(['A', 'B'])
	})

	it("runs a plugin's own error handler before an outer one declared after .use()", async () => {
		const order = <string[]>[]

		const plugin = new Elysia()
			.error(() => {
				order.push('plugin')

				return 'plugin'
			})
			.get('/sub', () => {
				throw new Error('boom')
			})

		const app = new Elysia()
			.use(plugin)
			.error(() => {
				order.push('outer')

				return 'outer'
			})
			.get('/main', () => {
				throw new Error('boom')
			})

		const sub = await app.handle('/sub').then((x) => x.text())

		expect(sub).toBe('plugin')
		expect(order).toEqual(['plugin'])
	})

	it('runs a global plugin error hook on plugin and parent routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.error('global', ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => {
				throw new Error('A')
			})

		const app = new Elysia().use(plugin).get('/outer', () => {
			throw new Error('A')
		})

		await Promise.all([app.handle('/inner'), app.handle('/outer')])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('runs a local plugin error hook only on plugin routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.error('local', ({ path }) => {
				called.push(path)

				return {}
			})
			.get('/inner', () => {
				throw new Error('A')
			})

		const app = new Elysia().use(plugin).get('/outer', () => {
			throw new Error('A')
		})

		await Promise.all([app.handle('/inner'), app.handle('/outer')])

		expect(called).toEqual(['/inner'])
	})

	it('handle custom error thrown in onRequest', async () => {
		class SomeCustomError extends Error {
			asJSON() {
				return JSON.stringify({
					somePretty: 'json'
				})
			}
		}

		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof SomeCustomError) return error.asJSON()
			})
			.request(() => {
				throw new SomeCustomError()
			})
			.get('/', () => '')

		const body = await app
			.handle(new Request('https://localhost/'))
			.then((x) => x.json())

		expect(body).toEqual({
			somePretty: 'json'
		})
	})

	it('handles an invalid cookie signature when its value is read', async () => {
		const app = new Elysia({
			cookie: { secrets: 'secrets', sign: ['session'] }
		})
			.error(({ error }) => {
				if (error instanceof InvalidCookie)
					return 'Where is the signature?'
			})
			.get('/', ({ cookie: { session } }) => session.value)

		const root = await app.handle(
			new Request('http://localhost/', {
				headers: {
					Cookie: 'session=1234'
				}
			})
		)

		await expect(root.text()).resolves.toBe('Where is the signature?')
		expect(root.status).toBe(400)
	})

	it("don't duplicate error from plugin", async () => {
		let i = 0

		const plugin = new Elysia()
			.error(() => {
				i++
			})
			.get('/', ({ status }) => {
				throw status(401)
			})

		const app = new Elysia().use(plugin)

		const response = await app.handle('/')
		expect(response.status).toBe(401)
		await expect(response.text()).resolves.toBe('Unauthorized')
		expect(i).toBe(1)
	})

	it('404 should parse query if infer', async () => {
		const app = new Elysia().error(({ query }) => query)

		const response = await app.handle(
			new Request('http://localhost?hello=world')
		)

		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toEqual({ hello: 'world' })
	})

	it('handle inline custom error message', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					x: t.Number({
						error: 'x must be a number'
					})
				})
			},
			() => 'Hello World!'
		)

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				body: JSON.stringify({ x: 'hi!' }),
				headers: {
					'Content-Type': 'application/json'
				}
			})
		)

		expect(response.status).toBe(422)

		const value = await response.text()
		expect(value).toBe('x must be a number')
	})

	it('handle inline custom error message with validationDetail', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					x: t.Number({
						error: validationDetail('x must be a number')
					})
				})
			},
			() => 'Hello World!'
		)

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				body: JSON.stringify({ x: 'hi!' }),
				headers: {
					'Content-Type': 'application/json'
				}
			})
		)

		expect(response.status).toBe(422)

		const value = (await response.json()) as Record<string, unknown>
		expect(value.type).toBe('validation')
		expect(value.message).toBe('x must be a number')
	})

	it('handle custom error message globally', async () => {
		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError)
					return error.detail(error.message)
			})
			.post(
				'/',
				{
					body: t.Object({
						x: t.Number({
							error: 'x must be a number'
						})
					})
				},
				() => 'Hello World!'
			)

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				body: JSON.stringify({ x: 'hi!' }),
				headers: {
					'Content-Type': 'application/json'
				}
			})
		)

		expect(response.status).toBe(422)

		const value = (await response.json()) as Record<string, unknown>
		expect(value.type).toBe('validation')
		expect(value.message).toBe('x must be a number')
	})

	it('ValidationError.detail only handle custom error', async () => {
		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError)
					return error.detail(error.message)
			})
			.post(
				'/',
				{
					body: t.Object({
						x: t.Number()
					})
				},
				() => 'Hello World!'
			)

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				body: JSON.stringify({ x: 'hi!' }),
				headers: {
					'Content-Type': 'application/json'
				}
			})
		)

		expect(response.status).toBe(422)

		const value = (await response.json()) as Record<string, unknown>
		expect(value.type).toBe('validation')
		expect(value.message).not.toStartWith('{')
	})

	it('ValidationError.all works with Zod validators', async () => {
		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError) {
					const errors = error.all

					return {
						message: 'Validation failed',
						errors: errors
					}
				}
			})
			.post(
				'/login',
				{
					body: z.object({
						username: z.string(),
						password: z.string()
					})
				},
				({ body }) => body
			)

		const res = await app.handle('/login', json({}))
		const data = (await res.json()) as any

		expect(data).toHaveProperty('message', 'Validation failed')
		expect(data).toHaveProperty('errors')
		expect(data.errors).toBeArray()
		expect(data.errors.length).toBeGreaterThan(0)
		expect(res.status).toBe(422)
	})

	it('ValidationError.all provides error details with Zod validators', async () => {
		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError) {
					const errors = error.all

					return {
						message: 'Validation failed',
						errors: errors.map((e: any) => ({
							path: e.path,
							message: e.message
						}))
					}
				}
			})
			.post(
				'/user',
				{
					body: z.object({
						name: z.string().min(3),
						email: z.string(),
						age: z.number().min(18)
					})
				},
				({ body }) => body
			)

		const res = await app.handle(
			'/user',
			json({
				name: 'ab',
				email: 'invalid',
				age: 10
			})
		)
		const data = (await res.json()) as any

		expect(data).toHaveProperty('message', 'Validation failed')
		expect(data).toHaveProperty('errors')
		expect(data.errors).toBeArray()
		expect(data.errors.length).toBeGreaterThan(0)

		for (const error of data.errors) {
			expect(error).toHaveProperty('path')
			expect(error).toHaveProperty('message')
		}

		expect(res.status).toBe(422)
	})
})

describe('Lazy validation error enumeration', () => {
	it('never enumerates errors when the error hook returns a constant', async () => {
		const spy = spyOn(TypeBoxValidator.prototype, 'Errors')

		try {
			const app = new Elysia()
				.error(() => 'expected a number')
				.post(
					'/',
					{
						body: t.Object({
							x: t.Number()
						})
					},
					({ body }) => body
				)

			const res = await app.handle('/', json({ x: 'not a number' }))

			expect(res.status).toBe(422)
			await expect(res.text()).resolves.toBe('expected a number')
			expect(spy).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})

	it('enumerates errors exactly once for the default 422 payload', async () => {
		const spy = spyOn(TypeBoxValidator.prototype, 'Errors')

		try {
			const app = new Elysia().post(
				'/',
				{
					body: t.Object({
						x: t.Number()
					})
				},
				({ body }) => body
			)

			const res = await app.handle('/', json({ x: 'not a number' }))
			const data = (await res.json()) as any

			expect(res.status).toBe(422)
			expect(spy).toHaveBeenCalledTimes(1)
			expect(data.errors).toBeArray()
			expect(data.errors.length).toBeGreaterThan(0)
			expect(data.found).toEqual({ x: 'not a number' })
		} finally {
			spy.mockRestore()
		}
	})

	it('exposes the same shape through the lazy form as the eager form', () => {
		const errors = [
			{
				instancePath: '/x',
				message: 'must be number'
			}
		]
		let calls = 0

		const lazy = new ValidationError('body', { x: 'a' }, () => {
			calls++
			return errors
		})

		expect(calls).toBe(0)

		const eager = new ValidationError('body', { x: 'a' }, errors)

		expect(lazy.message).toBe(eager.message)
		expect(lazy.errors).toEqual(eager.errors)
		expect(lazy.customError).toBe(eager.customError)
		expect(calls).toBe(1)

		expect({ ...lazy }.errors).toEqual(errors)
		expect(JSON.parse(JSON.stringify(lazy)).errors).toEqual(
			JSON.parse(JSON.stringify(eager)).errors
		)
		expect(Object.keys(lazy)).toContain('errors')
	})

	it('defers schema error callbacks until the error is read', async () => {
		let called = 0
		const schema = t.Object({
			x: t.Number({
				error() {
					called++
					return 'custom x'
				}
			})
		})

		const silent = new Elysia()
			.error(() => 'constant')
			.post('/', { body: schema }, ({ body }) => body)

		await silent.handle('/', json({ x: 'a' }))
		expect(called).toBe(0)

		const reading = new Elysia().post(
			'/',
			{
				body: schema
			},
			({ body }) => body
		)
		const res = await reading.handle('/', json({ x: 'a' }))

		expect(called).toBe(1)
		expect(res.status).toBe(422)
		await expect(res.text()).resolves.toBe('custom x')
	})
})

describe('Validation error payload echo limits', () => {
	const bigItems = Array.from({ length: 1024 }, (_, i) => `item-${i}`)

	it('echoes small bodies verbatim', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					x: t.Number()
				})
			},
			({ body }) => body
		)

		const res = await app.handle('/', json({ x: 'a' }))
		const data = (await res.json()) as any

		expect(res.status).toBe(422)
		expect(data.found).toEqual({ x: 'a' })
	})

	it('scopes the echo of a large body to the failing sub-value', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					id: t.Number(),
					items: t.Array(t.String())
				})
			},
			({ body }) => body
		)

		const res = await app.handle(
			'/',
			json({ id: 'not a number', items: bigItems })
		)
		const data = (await res.json()) as any

		expect(res.status).toBe(422)
		expect(data.found).toBe('not a number')
	})

	it('replaces the echo with a marker when the failing sub-value is also large', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					items: t.String()
				})
			},
			({ body }) => body
		)

		const res = await app.handle('/', json({ items: bigItems }))
		const text = await res.text()
		const data = JSON.parse(text) as any

		expect(res.status).toBe(422)
		expect(data.found).toContain('echo limit')
		expect(text.length).toBeLessThan(8192)
	})

	it('keeps the full value on the error object for user handlers', () => {
		const big = { id: 'bad', blob: 'x'.repeat(8192) }
		const err = new ValidationError('body', big, [
			{ instancePath: '/id', message: 'must be number' }
		])

		expect((err.payload as any).found).toBe('bad')
		expect(err.value).toBe(big)
		expect(err.all[0].value).toBe(big)
	})

	it('resolves the failing sub-value from a Standard Schema path array', () => {
		const big = { id: 'bad', blob: 'x'.repeat(8192) }
		const err = new ValidationError('body', big, [
			{ path: ['id'], message: 'expected number' }
		])

		expect((err.payload as any).found).toBe('bad')
	})

	// `value` is attached to every issue, so serializing `error.all` — a
	// documented handler pattern — used to duplicate the whole body once per
	// issue, making the response grow with the square of the request. Reading
	// it still works (pinned above); only enumeration drops it, and the body
	// is still reported once as `payload.found`
	it('keeps the per-error value out of serialization', () => {
		const big = { id: 'bad', blob: 'x'.repeat(8192) }
		const err = new ValidationError('body', big, [
			{ instancePath: '/id', message: 'must be number' },
			{ instancePath: '/id', message: 'must be number' }
		])

		const serialized = JSON.stringify(err.all)

		expect(err.all[0].value).toBe(big)
		expect(serialized).not.toContain('xxxx')
		expect(serialized.length).toBeLessThan(256)
	})

	// TypeBox stops at 8 issues on its own, but Standard Schema validators
	// never had any bound at all. Capping where every producer's issues
	// collapse makes the limit Elysia's own, so one bad element per array
	// entry can no longer turn a small request into a huge response. What is
	// pinned is that the list is constant in the size of the request — the
	// constant itself is a compatibility choice, so it is read from the
	// source rather than restated here
	it('caps the number of enumerated errors regardless of the producer', () => {
		const err = new ValidationError(
			'body',
			{ id: 'bad' },
			Array.from({ length: MAX_ERRORS * 100 }, () => ({
				instancePath: '/id',
				message: 'must be number'
			}))
		)

		expect(err.errors).toHaveLength(MAX_ERRORS)
		expect(err.all).toHaveLength(MAX_ERRORS)
		expect((err.payload as any).errors.length).toBeLessThanOrEqual(
			MAX_ERRORS
		)
	})

	// The cap is 64 rather than 8 because a truncated list answers a lookup
	// wrongly instead of loudly: a 20 field form reports 20 issues, and at 8
	// `error.all.find(...)` for a later field returns `undefined` as though
	// it had validated. The cap only binds Standard Schema — TypeBox stops at
	// 8 issues on its own, so the case has to be written against zod to be
	// about Elysia's bound at all
	it('enumerates every issue of a realistic form', async () => {
		const fields = Array.from({ length: 20 }, (_, i) => 'field' + i)

		let captured: ValidationError | undefined

		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError) captured = error
			})
			.post(
				'/',
				{
					body: z.object(
						Object.fromEntries(fields.map((f) => [f, z.string()]))
					)
				},
				({ body }) => body
			)

		await app.handle(
			'/',
			json(Object.fromEntries(fields.map((f) => [f, 1])))
		)

		expect(captured!.all).toHaveLength(fields.length)
		expect(captured!.all.find((e) => e.path === 'field12')).toBeDefined()
	})

	it('bounds the response of a Standard Schema validator reporting one error per element', async () => {
		const app = new Elysia().post(
			'/',
			{ body: z.object({ data: z.array(z.string()) }) },
			({ body }) => body
		)

		const size = async (n: number) => {
			const res = await app.handle('/', json({ data: Array(n).fill(0) }))

			expect(res.status).toBe(422)

			return (await res.text()).length
		}

		// Both bodies exceed the `found` echo limit, so the only thing left
		// that could still track `n` is the error list. Before the cap this
		// grew linearly at ~63x the body size — 2.5MB at n=20000
		const small = await size(5000)
		const large = await size(20000)

		expect(large).toBe(small)
		// flat in `n` is the property; the absolute bound just pins that
		// MAX_ERRORS issues still cost ~12KB rather than an order more
		expect(large).toBeLessThan(12_288)
	})

	// Capping the *number* of issues does nothing about the size of one. A
	// TypeBox issue carries its own copy of the offending value —
	// `params.additionalProperties` lists every excess key — so a body too
	// large to echo still came back through the issue, routing around the
	// bound `found` respects instead of defeating it
	it('bounds the value-derived params of an issue', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object(
					{ x: t.Number() },
					{ additionalProperties: false }
				)
			},
			({ body }) => body
		)

		const body: Record<string, unknown> = { x: 1 }
		for (let i = 0; i < 4096; i++) body['k' + i] = 1

		const res = await app.handle('/', json(body))
		const text = await res.text()
		const data = JSON.parse(text) as any

		expect(res.status).toBe(422)
		expect(data.errors[0].keyword).toBe('additionalProperties')
		expect(data.errors[0].params.additionalProperties).toContain(
			'echo limit'
		)
		expect(text.length).toBeLessThan(8192)
	})

	// A Standard Schema issue is handed to us raw, so the leak is not under
	// `params` at all: zod reports the excess keys as its own `keys` member
	// *and* interpolates them into `message`, which `payload.detail` reads.
	// Bounding only `params` would leave the two backends with contradictory
	// limits, the same inconsistency MAX_ERRORS exists to remove
	it('bounds the value-derived members of a Standard Schema issue', async () => {
		const app = new Elysia().post(
			'/',
			{ body: z.strictObject({ x: z.number() }) },
			({ body }) => body
		)

		const body: Record<string, unknown> = { x: 1 }
		for (let i = 0; i < 4096; i++) body['k' + i] = 1

		const res = await app.handle('/', json(body))
		const text = await res.text()
		const data = JSON.parse(text) as any

		expect(res.status).toBe(422)
		expect(data.errors[0].code).toBe('unrecognized_keys')
		expect(data.errors[0].keys).toContain('echo limit')
		expect(data.detail).toContain('echo limit')
		expect(text.length).toBeLessThan(8192)
	})

	// The budget is shared across issues rather than spent per issue.
	// MAX_ERRORS admits 64, so a per-issue 8192 would still admit ~512KB —
	// sixty-four times what the response already decided one echo of a
	// value is worth. Each issue below fits 8192 on its own and only the
	// shared budget stops the total
	it('shares one echo budget across every issue', () => {
		const keys = Array.from({ length: 512 }, (_, i) => 'key-' + i)

		const err = new ValidationError(
			'body',
			{},
			Array.from({ length: MAX_ERRORS }, () => ({
				keyword: 'additionalProperties',
				schemaPath: '#',
				instancePath: '',
				params: { additionalProperties: keys },
				message: 'must not have additional properties'
			}))
		)

		expect(err.errors).toHaveLength(MAX_ERRORS)
		// measured: 17KB sharing the budget, 331KB spending it per issue
		expect(JSON.stringify(err.payload).length).toBeLessThan(32_000)
	})

	// Narrowing is per member, so the schema-derived members a consumer
	// reads keep working when a sibling is the attacker-sized one, and
	// `params` stays a record instead of turning into a string
	it('keeps the schema-derived params members when narrowing', () => {
		const err = new ValidationError('body', {}, [
			{
				keyword: 'additionalProperties',
				schemaPath: '#',
				instancePath: '',
				params: {
					type: 'object',
					additionalProperties: Array.from(
						{ length: 4096 },
						(_, i) => 'key-' + i
					)
				},
				message: 'must not have additional properties'
			}
		])

		const { params } = (err.payload as any).errors[0]

		expect(params.type).toBe('object')
		expect(params.additionalProperties).toContain('echo limit')
		expect(err.all[0].params.type).toBe('object')
	})

	// An issue that fits is emitted untouched, object identity included —
	// the bound may not rewrite the ordinary case
	it('leaves an issue that fits the budget untouched', () => {
		const issue = {
			keyword: 'type',
			schemaPath: '#/properties/id',
			instancePath: '/id',
			params: { type: 'number' },
			message: 'must be number'
		}

		const err = new ValidationError('params', { id: 'a' }, [issue])

		expect(err.errors[0]).toBe(issue)
		expect((err.payload as any).errors[0].params).toBe(issue.params)
	})
})
