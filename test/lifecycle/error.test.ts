/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	Elysia,
	InternalServerError,
	InvalidCookieSignature,
	NotFound,
	ParseError,
	ValidationError,
	t,
	validationDetail
} from '../../src'
import { describe, expect, it, spyOn } from 'bun:test'
import { post, req } from '../utils'
import * as z from 'zod'

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

		const root = await app.handle(req('/')).then((x) => x.text())
		const notFound = await app
			.handle(req('/not/found'))
			.then((x) => x.text())

		expect(root).toBe('hello')
		expect(notFound).toBe('UwU')
	})

	it('handle parse error', async () => {
		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ParseError)
					return 'Why you no proper type'
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

		expect(await root.text()).toBe('Why you no proper type')
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
			.post('/login', ({ body }) => body, {
				body: t.Object({
					username: t.String(),
					password: t.String()
				})
			})

		const res = await app.handle(post('/login', {}))
		const data = await res.json()

		expect(data).toBeArray()
		expect(res.status).toBe(400)
	})

	it('inherits plugin', async () => {
		const plugin = new Elysia().error('global', () => 'hi')

		const app = new Elysia().use(plugin).get('/', () => {
			throw new Error('')
		})

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('not inherits plugin on local', async () => {
		const plugin = new Elysia().error(() => 'hi')

		const app = new Elysia().use(plugin).get('/', () => {
			throw new Error('')
		})

		const res = await app.handle(req('/')).then((t) => t.text())
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

		const response = await app.handle(req('/'))

		expect(await response.text()).toBe('UwU')
		expect(response.status).toBe(500)
	})

	it('coerces a stray set.status = 200 in an error handler to 500', async () => {
		// `undefined` is the default status now, not 200; a 200 reaching the
		// error path is a leftover from the aborted success path (a handler or
		// beforeHandle that optimistically set 200 then threw), so it must not
		// escape as the error response status
		const app = new Elysia()
			.error(({ set }) => {
				set.status = 200

				return 'recovered?'
			})
			.get('/', () => {
				throw new Error('boom')
			})

		const response = await app.handle(req('/'))

		expect(await response.text()).toBe('recovered?')
		expect(response.status).toBe(500)
	})

	it('respects an explicit status() recovery from an error handler', async () => {
		// an explicit status(200) is a deliberate choice (carried by the
		// ElysiaStatus code), not a leftover — it must still win
		const app = new Elysia()
			.error(({ status }) => status(200, 'recovered'))
			.get('/', () => {
				throw new Error('boom')
			})

		const response = await app.handle(req('/'))

		expect(await response.text()).toBe('recovered')
		expect(response.status).toBe(200)
	})

	it(
		'return correct number status on error function',
		async () => {
			const app = new Elysia().get('/', ({ status }) =>
				status(418, 'I am a teapot')
			)

			const response = await app.handle(req('/'))

			expect(response.status).toBe(418)
		}
	)

	it(
		'return correct named status on error function',
		async () => {
			const app = new Elysia().get('/', ({ status }) =>
				status("I'm a teapot", 'I am a teapot')
			)

			const response = await app.handle(req('/'))

			expect(response.status).toBe(418)
		}
	)

	it(
		'return correct number status without value on error function',
		async () => {
			const app = new Elysia().get('/', ({ status }) => status(418))

			const response = await app.handle(req('/'))

			expect(response.status).toBe(418)
			expect(await response.text()).toBe("I'm a teapot")
		}
	)

	it(
		'return correct named status without value on error function',
		async () => {
			const app = new Elysia().get('/', ({ status }) =>
				status("I'm a teapot")
			)

			const response = await app.handle(req('/'))

			expect(response.status).toBe(418)
			expect(await response.text()).toBe("I'm a teapot")
		}
	)

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

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('as global', async () => {
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

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('as local', async () => {
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

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner'])
	})

	// New direct-scope API: `error('global', fn)` parallels
	// `onError('global', fn)`.
	it('as global (direct scope)', async () => {
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

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('as local (direct scope)', async () => {
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

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner'])
	})

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.afterHandle([
				() => {
					total++
				},
				() => {
					total++
				}
			])
			.get('/', () => 'NOOP')

		const res = await app.handle(req('/'))

		expect(total).toEqual(2)
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

	it('handle cookie signature error', async () => {
		const app = new Elysia({
			cookie: { secrets: 'secrets', sign: ['session'] }
		})
			.error(({ error }) => {
				if (error instanceof InvalidCookieSignature)
					return 'Where is the signature?'
			})
			.get('/', ({ cookie: { session } }) => '')

		const root = await app.handle(
			new Request('http://localhost/', {
				headers: {
					Cookie: 'session=1234'
				}
			})
		)

		expect(await root.text()).toBe('Where is the signature?')
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

		const response = await app.handle(req('/'))
		expect(response.status).toBe(401)
		expect(await response.text()).toBe('Unauthorized')
		expect(i).toBe(1)
	})

	it('404 should parse query if infer', async () => {
		const app = new Elysia().error(({ query }) => query)

		const response = await app.handle(
			new Request('http://localhost?hello=world')
		)

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({ hello: 'world' })
	})

	it('handle inline custom error message', async () => {
		const app = new Elysia().post('/', () => 'Hello World!', {
			body: t.Object({
				x: t.Number({
					error: 'x must be a number'
				})
			})
		})

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
		const app = new Elysia().post('/', () => 'Hello World!', {
			body: t.Object({
				x: t.Number({
					error: validationDetail('x must be a number')
				})
			})
		})

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
			.post('/', () => 'Hello World!', {
				body: t.Object({
					x: t.Number({
						error: 'x must be a number'
					})
				})
			})

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
			.post('/', () => 'Hello World!', {
				body: t.Object({
					x: t.Number()
				})
			})

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
			.post('/login', ({ body }) => body, {
				body: z.object({
					username: z.string(),
					password: z.string()
				})
			})

		const res = await app.handle(post('/login', {}))
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
							message: e.message,
						}))
					}
				}
			})
			.post('/user', ({ body }) => body, {
				body: z.object({
					name: z.string().min(3),
					email: z.string(),
					age: z.number().min(18)
				})
			})

		const res = await app.handle(
			post('/user', {
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

// F36: error enumeration is lazy. typebox's interpreted Errors() walk is
// O(body) per failure, so throw sites pass a thunk and ValidationError only
// runs it when something reads `errors` / `message` / `customError` — an
// error handler returning a constant never pays the walk.
describe('Lazy validation error enumeration', () => {
	it('never enumerates errors when the error hook returns a constant', async () => {
		const spy = spyOn(TypeBoxValidator.prototype, 'Errors')

		try {
			const app = new Elysia()
				.error(() => 'expected a number')
				.post('/', ({ body }) => body, {
					body: t.Object({
						x: t.Number()
					})
				})

			const res = await app.handle(post('/', { x: 'not a number' }))

			expect(res.status).toBe(422)
			expect(await res.text()).toBe('expected a number')
			expect(spy).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})

	it('enumerates errors exactly once for the default 422 payload', async () => {
		const spy = spyOn(TypeBoxValidator.prototype, 'Errors')

		try {
			const app = new Elysia().post('/', ({ body }) => body, {
				body: t.Object({
					x: t.Number()
				})
			})

			const res = await app.handle(post('/', { x: 'not a number' }))
			const data = (await res.json()) as any

			expect(res.status).toBe(422)
			// payload reads `errors` + `message` + `customError`; the
			// enumeration must be memoized across them
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
				message: 'must be number',
			}
		]
		let calls = 0

		const lazy = new ValidationError('body', { x: 'a' }, () => {
			calls++
			return errors
		})

		// nothing read yet — the thunk must not have run
		expect(calls).toBe(0)

		const eager = new ValidationError('body', { x: 'a' }, errors)

		expect(lazy.message).toBe(eager.message)
		expect(lazy.errors).toEqual(eager.errors)
		expect(lazy.customError).toBe(eager.customError)
		expect(calls).toBe(1)

		// own-enumerable parity: spread / stringify / keys keep `errors`
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
			.post('/', ({ body }) => body, { body: schema })

		await silent.handle(post('/', { x: 'a' }))
		expect(called).toBe(0)

		const reading = new Elysia().post('/', ({ body }) => body, {
			body: schema
		})
		const res = await reading.handle(post('/', { x: 'a' }))

		expect(called).toBe(1)
		expect(res.status).toBe(422)
		expect(await res.text()).toBe('custom x')
	})
})

// F37: the default 422 payload echoes the offending value back (`found`).
// A large body was 1:1 reflection amplification (attacker-driven egress,
// no auth needed) plus an extra O(body) serialization per failure — the echo
// is now scoped to the failing sub-value once the body exceeds the limit,
// while small bodies stay byte-identical.
describe('Scoped found echo on the default 422 payload', () => {
	const bigItems = Array.from({ length: 1024 }, (_, i) => `item-${i}`)

	it('echoes small bodies verbatim', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				x: t.Number()
			})
		})

		const res = await app.handle(post('/', { x: 'a' }))
		const data = (await res.json()) as any

		expect(res.status).toBe(422)
		expect(data.found).toEqual({ x: 'a' })
	})

	it('scopes the echo of a large body to the failing sub-value', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				id: t.Number(),
				items: t.Array(t.String())
			})
		})

		const res = await app.handle(
			post('/', { id: 'not a number', items: bigItems })
		)
		const data = (await res.json()) as any

		expect(res.status).toBe(422)
		expect(data.found).toBe('not a number')
	})

	it('replaces the echo with a marker when the failing sub-value is also large', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				items: t.String()
			})
		})

		const res = await app.handle(post('/', { items: bigItems }))
		const text = await res.text()
		const data = JSON.parse(text) as any

		expect(res.status).toBe(422)
		expect(data.found).toContain('echo limit')
		// no reflection amplification: a ~14KB body must not produce a
		// body-sized response
		expect(text.length).toBeLessThan(8192)
	})

	it('keeps the full value on the error object for user handlers', () => {
		const big = { id: 'bad', blob: 'x'.repeat(8192) }
		const err = new ValidationError('body', big, [
			{ instancePath: '/id', message: 'must be number' }
		])

		expect((err.payload as any).found).toBe('bad')
		// `.value` and `.all` are user-facing — only the payload echo is
		// scoped
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
})
