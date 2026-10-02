/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, NotFound, ValidationError, status, t } from '../../src'
import { setAsyncTail, setOnEmit } from '../../src/compile/handler/jit'

import { describe, expect, it } from 'bun:test'
import { post, json, req } from '../utils'

import z from 'zod'
import type { AnyElysia } from '../../src/base'

class CustomError extends Error {
	constructor() {
		super()
	}
}

class CustomError2 extends Error {
	constructor() {
		super()
	}
}

class SubError extends CustomError {}

class TeapotError extends Error {
	status = 418
}

const throws = (Class: new () => Error) => () => {
	throw new Class()
}

const text = (app: AnyElysia, path: string) =>
	app.handle(path).then((response) => response.text())

// An error class is "registered" only by the handler `.error(Class, fn)`
// attaches: dispatch is `instanceof`, there is no code dictionary to consult
describe('Error extends', () => {
	it('dispatches a class handler only to instances of that class', async () => {
		const app = new Elysia()
			.error(CustomError, () => 'custom')
			.get('/custom', throws(CustomError))
			.get('/sub', throws(SubError))
			.get('/other', throws(CustomError2))

		await expect(text(app, '/custom')).resolves.toBe('custom')
		// subclasses are instances too
		await expect(text(app, '/sub')).resolves.toBe('custom')

		// an unrelated class falls through to the default problem response
		const other = await app.handle('/other')
		expect(other.status).toBe(500)
		expect(await other.json()).toMatchObject({
			code: 'internal-server-error'
		})
	})

	it('dispatches several classes to their own handlers', async () => {
		const app = new Elysia()
			.error(CustomError, () => 'one')
			.error(CustomError2, () => 'two')
			.get('/one', throws(CustomError))
			.get('/two', throws(CustomError2))

		await expect(text(app, '/one')).resolves.toBe('one')
		await expect(text(app, '/two')).resolves.toBe('two')
	})

	it('lets the first handler registered for a class win', async () => {
		const app = new Elysia()
			.error(CustomError, () => 'first')
			.error(CustomError, () => 'second')
			.get('/', throws(CustomError))

		await expect(text(app, '/')).resolves.toBe('first')
	})

	it('answers a static value registered for a class', async () => {
		const app = new Elysia()
			.error(CustomError, 'static')
			.get('/', throws(CustomError))

		await expect(text(app, '/')).resolves.toBe('static')
	})

	it('passes the thrown instance, and no error code, to the handler', async () => {
		let context: Record<string, unknown> | undefined
		const thrown = new CustomError()

		const app = new Elysia()
			.error(CustomError, (ctx) => {
				context = ctx
				return 'handled'
			})
			.get('/', () => {
				throw thrown
			})

		await app.handle('/')

		expect(context?.error).toBe(thrown)
		expect(context && 'code' in context).toBe(false)
	})

	it('maps the status from the error class, overridable by the handler', async () => {
		const app = new Elysia()
			.error(TeapotError, () => 'tea')
			.get('/', throws(TeapotError))

		const response = await app.handle('/')
		expect(response.status).toBe(418)
		expect(await response.text()).toBe('tea')

		const overridden = await new Elysia()
			.error(TeapotError, ({ status }) => status(409, 'conflict'))
			.get('/', throws(TeapotError))
			.handle('/')
		expect(overridden.status).toBe(409)
		expect(await overridden.text()).toBe('conflict')

		// a handled error without a status stays a server error
		const plain = await new Elysia()
			.error(CustomError, () => 'handled')
			.get('/', throws(CustomError))
			.handle('/')
		expect(plain.status).toBe(500)
	})

	it('inherits a class handler from a functional plugin', async () => {
		const plugin = (app: Elysia) =>
			app.error(CustomError, () => 'functional')

		const app = new Elysia().use(plugin).get('/', throws(CustomError))

		await expect(text(app, '/')).resolves.toBe('functional')
	})

	it('scopes a class handler absorbed from an instance plugin', async () => {
		const route = (plugin: AnyElysia) =>
			text(new Elysia().use(plugin).get('/', throws(CustomError)), '/')
		const grandchild = (plugin: AnyElysia) =>
			text(
				new Elysia()
					.use(new Elysia().use(plugin))
					.get('/', throws(CustomError)),
				'/'
			)

		const local = new Elysia().error(CustomError, () => 'local')
		const plugin = new Elysia().error('plugin', CustomError, () => 'plugin')
		const global = new Elysia().error('global', CustomError, () => 'global')

		// local: stays inside the plugin
		await expect(route(local)).resolves.not.toBe('local')
		// plugin: reaches the direct parent only
		await expect(route(plugin)).resolves.toBe('plugin')
		await expect(grandchild(plugin)).resolves.not.toBe('plugin')
		// global: reaches every ancestor
		await expect(route(global)).resolves.toBe('global')
		await expect(grandchild(global)).resolves.toBe('global')
	})

	// zod v4 `ZodError` is a factory whose prototype does not extend Error
	// (only `ZodRealError`, thrown by `.parse()`, does) and matches through
	// its own Symbol.hasInstance: the 2-arg form must register it like the
	// 3-arg form does, not misread it as a hook scope and throw
	it('registers an error class whose prototype does not extend Error', async () => {
		const app = new Elysia()
			.error(z.ZodError, ({ error }) => `zod ${error.issues.length}`)
			.get('/', () => z.string().parse(1))

		await expect(text(app, '/')).resolves.toBe('zod 1')

		// no explicit scope: it comes from the instance config
		const plugin = new Elysia({ as: 'global' }).error(
			z.ZodError,
			() => 'global zod'
		)

		await expect(
			text(
				new Elysia()
					.use(new Elysia().use(plugin))
					.get('/', () => z.string().parse(1)),
				'/'
			)
		).resolves.toBe('global zod')
	})

	// 1.x `.error({ CODE: Class })` registered an error-code dictionary; 2.0
	// dropped error codes (dispatch is by class), so the untyped object form
	// registers no handler at all
	it('ignores the 1.x error-code dictionary form', async () => {
		const app = new Elysia()
			.error({ CUSTOM: CustomError } as any)
			.error(({ error }) => (error instanceof CustomError ? 'general' : undefined))
			.get('/', throws(CustomError))

		await expect(text(app, '/')).resolves.toBe('general')

		const bare = await new Elysia()
			.error({ CUSTOM: CustomError } as any)
			.get('/', throws(CustomError))
			.handle('/')
		expect(bare.status).toBe(500)
	})

	it('preserve status code base on error if not set', async () => {
		const app = new Elysia().error(({ error }) => {
			if (error instanceof NotFound) return 'UwU'
		})

		const response = await app.handle('/not/found')

		await expect(response.text()).resolves.toBe('UwU')
		expect(response.status).toBe(404)
	})

	it('validation error should be application/problem+json', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Null()
			},
			// @ts-expect-error
			() => '1'
		)

		const response = await app.handle('/')

		expect(response.status).toBe(500)
		expect(response.headers.get('content-type')).toBe(
			'application/problem+json'
		)
	})

	it('validation error should handle Standard Schema with error.detail', async () => {
		const sendOtpEmailSchema = z.object({
			channel: z.literal('email'),
			otpTo: z.email({ error: 'Must be a valid email address' })
		})

		const sendOtpSmsSchema = z.object({
			channel: z.literal('sms'),
			otpTo: z.e164({
				error: 'Must be a valid phone number with country code'
			})
		})

		const sendOtpSchema = z.discriminatedUnion('channel', [
			sendOtpEmailSchema,
			sendOtpSmsSchema
		])

		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError)
					return error.detail(error.message)
			})
			.post(
				'/',
				{
					body: sendOtpSchema
				},
				({ body, set }) => 'ok'
			)

		const response = await app.handle('/', json({}))

		expect(response.status).toBe(422)
	})
})

// A handler or beforeHandle RETURNING an Error is rethrown into the error
// lane. An instance of a class registered with `.error(Class, fn)` must be
// too, even when it is not an Error (zod v4 `new ZodError()`): otherwise its
// handler, and the status the route's type claims for it, are skipped and
// the instance is served as a 200 value
describe('returned error class instance', () => {
	// `name` + `message` satisfy the `.error(Class)` type, yet instances are
	// not Errors: only the registration makes them one
	class Problem {
		name = 'Problem'
		message = 'problem'
	}

	const problemHandler = () => status(418, 'problem')

	it('rethrows a returned zod ZodError to its global class handler', async () => {
		const app = () =>
			new Elysia()
				.use(
					new Elysia({ as: 'global' }).error(z.ZodError, () =>
						status(418, 'quack')
					)
				)
				.get('/', () => new z.ZodError([]))

		// the sync-first async tail (Bun default) and the plain async lane
		for (const tail of [undefined, false]) {
			setAsyncTail(tail)

			try {
				const response = await app().handle('/')

				expect({
					tail,
					status: response.status,
					body: await response.text()
				}).toEqual({ tail, status: 418, body: 'quack' })
			} finally {
				setAsyncTail(undefined)
			}
		}
	})

	// The reported repro: a hand-built ZodError used to be served as `200 []`
	it('serves the reported 3-arg global zod handler repro as 418', async () => {
		const errorHandler = new Elysia().error('global', z.ZodError, ({ error }) =>
			status(418, `quack! ${error.message}`)
		)

		const app = new Elysia()
			.use(errorHandler)
			.get('/', () => new z.ZodError([]))

		const response = await app.handle('/')

		expect(response.status).toBe(418)
		expect(await response.text()).toBe('quack! []')
	})

	// Registered after the routes, the class reaches them only through the
	// app-level error lane, so they stay on the sync lanes that forward a
	// returned Promise themselves
	it('ends a returned root-only class instance like a thrown one', async () => {
		type Route = (app: AnyElysia, handler: () => unknown) => AnyElysia

		const lanes: [lane: string, route: Route, status: number][] = [
			['bare GET', (app, h) => app.get('/', h), 418],
			['bare POST', (app, h) => app.post('/', h), 418],
			[
				'beforeHandle',
				(app, h) => app.get('/', { beforeHandle: () => {} }, h),
				418
			],
			[
				'sync afterResponse',
				(app, h) => app.afterResponse(() => {}).get('/', h),
				418
			],
			// Its own hooks never reach the app-level lane: a thrown instance
			// falls back to a 500 there, so must a returned one. `() => {}`, not
			// `() => undefined`, which may return a Promise and goes async
			[
				'own sync error hook',
				(app, h) => app.error(() => {}).get('/', h),
				500
			]
		]

		const shapes: [
			shape: string,
			returns: () => unknown,
			throws: () => unknown
		][] = [
			[
				'instance',
				() => new Problem(),
				() => {
					throw new Problem()
				}
			],
			[
				'Promise',
				() => Promise.resolve(new Problem()),
				() => Promise.reject(new Problem())
			]
		]

		for (const [lane, route, expected] of lanes)
			for (const [shape, returns, throws] of shapes) {
				const respond = async (handler: () => unknown) => {
					const response = await route(new Elysia(), handler)
						.error(Problem, problemHandler)
						.handle(lane === 'bare POST' ? post('/') : req('/'))

					return {
						lane,
						shape,
						status: response.status,
						body: await response.text()
					}
				}

				const returned = await respond(returns)

				expect(returned).toEqual(await respond(throws))
				expect(returned.status).toBe(expected)
			}
	})

	it('rethrows an instance a beforeHandle returns', async () => {
		const response = await new Elysia()
			.error(Problem, problemHandler)
			.get('/', { beforeHandle: () => new Problem() }, () => 'handler')
			.handle('/')

		expect(response.status).toBe(418)
		expect(await response.text()).toBe('problem')
	})

	it('throws a registered class instance served as a static value', async () => {
		const response = await new Elysia()
			.error(Problem, problemHandler)
			.get('/', new Problem() as any)
			.handle('/')

		expect(response.status).toBe(418)
		expect(await response.text()).toBe('problem')
	})

	// Only in scope: like any non-Error, an instance no reachable handler
	// claims is a plain value
	it('leaves an instance no reachable handler claims as a value', async () => {
		const app = new Elysia()
			.use(
				new Elysia()
					.error(Problem, problemHandler)
					.get('/inside', () => new Problem())
			)
			.get('/outside', () => new Problem())

		const inside = await app.handle('/inside')
		expect(inside.status).toBe(418)
		expect(await inside.text()).toBe('problem')

		expect((await app.handle('/outside')).status).toBe(200)
	})

	// `instanceof Error` already rethrows an Error subclass: only a route that
	// can see a non-Error class pays for the class check
	it('adds the class check only to routes that can see a non-Error class', async () => {
		const emitted: string[] = []
		setOnEmit((code) => {
			emitted.push(code)
		})

		try {
			await new Elysia()
				.error(CustomError, () => 'custom')
				.get('/', () => 'hi')
				.handle('/')
			await new Elysia()
				.error(Error, () => 'error')
				.get('/', () => 'hi')
				.handle('/')

			expect(emitted).toHaveLength(2)
			for (const code of emitted) expect(code).not.toMatch(/\bie\(/)

			emitted.length = 0
			await new Elysia()
				.error(z.ZodError, () => 'zod')
				.get('/', () => 'hi')
				.handle('/')

			expect(emitted).toHaveLength(1)
			expect(emitted[0]).toMatch(/\bie\(/)
		} finally {
			setOnEmit(undefined)
		}
	})

	// An arrow has no prototype: as a class, `instanceof` would throw on
	// every later error dispatch, so it must fail at registration
	it('rejects a prototype-less function as an error class', () => {
		expect(() => new Elysia().error((() => 1) as any, () => 'x')).toThrow(
			/Invalid hook scope/
		)

		expect(() => new Elysia().error(z.ZodError, () => 'x')).not.toThrow()
	})
})
