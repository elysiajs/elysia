/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	Elysia,
	InternalServerError,
	ParseError,
	ValidationError,
	error,
	t,
	validationDetail
} from '../../src'
import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('error', () => {
	it('use custom 404', async () => {
		const app = new Elysia()
			.get('/', () => 'hello')
			.onError(({ code, set }) => {
				if (code === 'NOT_FOUND') {
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
			.onError(({ code }) => {
				if (code === 'PARSE') return 'Why you no proper type'
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
			.onError(({ code, error, set }) => {
				if (code === 'VALIDATION') {
					set.status = 400

					return error.all.map((i) =>
						i.summary
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
		const plugin = new Elysia().onError({ as: 'global' }, () => 'hi')

		const app = new Elysia().use(plugin).get('/', () => {
			throw new Error('')
		})

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('hi')
	})

	it('not inherits plugin on local', async () => {
		const plugin = new Elysia().onError(() => 'hi')

		const app = new Elysia().use(plugin).get('/', () => {
			throw new Error('')
		})

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).not.toBe('hi')
	})

	it('custom 500', async () => {
		const app = new Elysia()
			.onError(({ code }) => {
				if (code === 'INTERNAL_SERVER_ERROR') {
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

	it.each([true, false])(
		'return correct number status on error function with aot: %p',
		async (aot) => {
			const app = new Elysia({ aot }).get('/', ({ error }) =>
				error(418, 'I am a teapot')
			)

			const response = await app.handle(req('/'))

			expect(response.status).toBe(418)
		}
	)

	it.each([true, false])(
		'return correct named status on error function with aot: %p',
		async (aot) => {
			const app = new Elysia({ aot }).get('/', ({ error }) =>
				error("I'm a teapot", 'I am a teapot')
			)

			const response = await app.handle(req('/'))

			expect(response.status).toBe(418)
		}
	)

	it.each([true, false])(
		'return correct number status without value on error function with aot: %p',
		async (aot) => {
			const app = new Elysia({ aot }).get('/', ({ error }) => error(418))

			const response = await app.handle(req('/'))

			expect(response.status).toBe(418)
			expect(await response.text()).toBe("I'm a teapot")
		}
	)

	it.each([true, false])(
		'return correct named status without value on error function with aot: %p',
		async (aot) => {
			const app = new Elysia({ aot }).get('/', ({ error }) =>
				error("I'm a teapot")
			)

			const response = await app.handle(req('/'))

			expect(response.status).toBe(418)
			expect(await response.text()).toBe("I'm a teapot")
		}
	)

	it('handle error in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.onError(() => {
				order.push('A')
			})
			.onError(() => {
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
			.onError({ as: 'global' }, ({ path }) => {
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
			.onError({ as: 'local' }, ({ path }) => {
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

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.onAfterHandle([
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
			.onError(({ error }) => {
				if (error instanceof SomeCustomError) return error.asJSON()
			})
			.onRequest(() => {
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
			.onError(({ code, error }) => {
				if (code === 'INVALID_COOKIE_SIGNATURE')
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
			.onError(() => {
				i++
			})
			.get('/', ({ status }) => {
				throw status(401)
			})

		const app = new Elysia().use(plugin).listen(3000)

		const response = await app.handle(req('/'))
		expect(response.status).toBe(401)
		expect(await response.text()).toBe('Unauthorized')
		expect(i).toBe(1)
	})

	it('404 should parse query if infer', async () => {
		const app = new Elysia().onError(({ query }) => query)

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
			.onError(({ error, code }) => {
				if (code === 'VALIDATION') return error.detail(error.message)
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
			.onError(({ error, code }) => {
				if (code === 'VALIDATION') return error.detail(error.message)
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
})
