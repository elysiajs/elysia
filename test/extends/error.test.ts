/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, NotFound, ValidationError, status, t } from '../../src'
import { setAsyncTail, setOnEmit } from '../../src/compile/handler/jit'

import { describe, expect, it } from 'bun:test'
import { post, json, req } from '../utils'

import z from 'zod'
import type { AnyElysia } from '../../src/base'
import {
	aotReconstructHandle,
	jitHandle,
	lazyHandle,
	nativeStaticOn,
	precompileHandle,
	type Define,
	type LaneFactory
} from '../differential/lanes'
import { trace } from '../../src/plugin/trace'

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

	// Registered before the routes (a hook reaches only the routes after it),
	// the class rides each lane's own error hooks: a returned instance must
	// end like a thrown one, a returned Promise included
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
			// `() => {}`, not `() => undefined`, which may return a Promise and
			// goes async
			[
				'own sync error hook',
				(app, h) => app.error(() => {}).get('/', h),
				418
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
					const response = await route(
						new Elysia().error(Problem, problemHandler),
						handler
					).handle(lane === 'bare POST' ? post('/') : req('/'))

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

// A hook reaches only the routes registered after it, `.error()` included:
// the Elysia 1 rule (life-cycle "order of code", 1.0 "local first"). A
// matched route's error ends with its own hooks, as Elysia 1's `skipGlobal`
describe('hook registered after the route', () => {
	class Late extends Error {}

	const lanes = [
		lazyHandle,
		jitHandle,
		precompileHandle,
		aotReconstructHandle
	]

	const shapes: [shape: string, handler: () => unknown][] = [
		['returned', () => new Late()],
		[
			'thrown',
			() => {
				throw new Late()
			}
		],
		['rejected', () => Promise.reject(new Late())]
	]

	const serve = async (lane: LaneFactory, define: Define, path = '/') => {
		const instance = await lane.make(define)

		try {
			const response = await instance.handle(req(path))

			return `${response.status} ${await response.text()}`
		} finally {
			await instance.dispose()
		}
	}

	const decline = () => {}
	const answer = () => status(418, 'late')

	const lateHooks: [hook: string, add: (app: AnyElysia) => AnyElysia][] = [
		['a class handler', (app) => app.error(Late, answer)],
		['a global class handler', (app) => app.error('global', Late, answer)],
		['a catch-all', (app) => app.error(answer)],
		['a global catch-all', (app) => app.error('global', answer)]
	]

	const routes: [
		route: string,
		define: (app: AnyElysia, handler: () => unknown) => AnyElysia
	][] = [
		['without error hooks', (app, h) => app.get('/', h)],
		['after a catch-all', (app, h) => app.error(decline).get('/', h)],
		[
			'with a local error hook',
			(app, h) => app.get('/', { error: decline }, h)
		],
		['behind a request hook', (app, h) => app.request(() => {}).get('/', h)]
	]

	for (const lane of lanes)
		for (const [shape, handler] of shapes)
			it(`never reaches an earlier route with ${lane.id}, ${shape}`, async () => {
				const served: Record<string, string> = {}

				for (const [route, define] of routes)
					for (const [hook, add] of lateHooks)
						served[`${route}, ${hook}`] = (
							await serve(lane, (app) =>
								add(define(app, handler))
							)
						).slice(0, 3)

				expect(served).toEqual(
					Object.fromEntries(
						Object.keys(served).map((k) => [k, '500'])
					)
				)
			})

	// The same hooks registered before the route do reach it
	for (const lane of lanes)
		for (const [shape, handler] of shapes)
			it(`reaches a later route with ${lane.id}, ${shape}`, async () => {
				const served: Record<string, string> = {}

				for (const [hook, add] of lateHooks)
					served[hook] = await serve(lane, (app) =>
						add(app).get('/', handler)
					)

				expect(served).toEqual(
					Object.fromEntries(
						lateHooks.map(([hook]) => [hook, '418 late'])
					)
				)
			})

	// What fails before routing has no route to stop at: a 404 or a request
	// hook's error still reaches every app-level hook, a later one too
	for (const lane of lanes)
		it(`leaves errors before routing to every hook with ${lane.id}`, async () => {
			const served = {
				notFound: await serve(
					lane,
					(app) =>
						app
							.get('/', () => 'ok')
							.error(({ error }) =>
								error instanceof NotFound
									? status(418, 'late')
									: undefined
							),
					'/missing'
				),
				request: await serve(lane, (app) =>
					app
						.request(() => {
							throw new Late()
						})
						.get('/', () => 'ok')
						.error(Late, answer)
				)
			}

			expect(served).toEqual({
				notFound: '418 late',
				request: '418 late'
			})
		})

	// The one exception Elysia 1 keeps on purpose: inside a `.group()` or
	// `.guard()` callback, the callback's error hooks, of any scope, cover
	// every route the callback produces (1.x "handle error in group"), and
	// stay inside it
	const callbacks: [
		kind: string,
		wrap: (
			app: AnyElysia,
			run: (inner: AnyElysia) => AnyElysia
		) => AnyElysia,
		prefix: string
	][] = [
		['group', (app, run) => app.group('/g', run), '/g'],
		['guard', (app, run) => app.guard({}, run), '']
	]

	const produced: [
		route: string,
		declare: (inner: AnyElysia) => AnyElysia,
		path: string
	][] = [
		['its own route', (inner) => inner.get('/r', () => new Late()), '/r'],
		[
			'a used plugin',
			(inner) => inner.use(new Elysia().get('/r', () => new Late())),
			'/r'
		],
		[
			'a nested group',
			(inner) => inner.group('/n', (n) => n.get('/r', () => new Late())),
			'/n/r'
		],
		[
			'a nested guard',
			(inner) => inner.guard({}, (n) => n.get('/r', () => new Late())),
			'/r'
		]
	]

	const callbackHooks: [
		scope: string,
		add: (inner: AnyElysia) => AnyElysia
	][] = [
		['local', (inner) => inner.error(Late, answer)],
		['plugin', (inner) => inner.error('plugin', Late, answer)],
		['global', (inner) => inner.error('global', Late, answer)]
	]

	for (const lane of lanes)
		it(`lets a group or guard callback's error hook cover its routes with ${lane.id}`, async () => {
			const served: Record<string, string> = {}

			for (const [kind, wrap, prefix] of callbacks)
				for (const [route, declare, path] of produced)
					for (const [scope, add] of callbackHooks)
						served[`${kind}, ${route}, ${scope}`] = await serve(
							lane,
							(app) => wrap(app, (inner) => add(declare(inner))),
							prefix + path
						)

			expect(served).toEqual(
				Object.fromEntries(
					Object.keys(served).map((k) => [k, '418 late'])
				)
			)
		})

	// Nested callbacks, as in Elysia 1.4.30: the callbacks' later error hooks
	// run innermost first. One an outer callback registered before creating
	// the inner is an ordinary earlier hook: it comes first, before the
	// inner's later one, and before a route's own hook too
	for (const lane of lanes)
		it(`runs nested callbacks' error hooks innermost first with ${lane.id}`, async () => {
			const nested = (inner: () => unknown) => (app: AnyElysia) =>
				app.group('/g', (outer) =>
					outer
						.group('/n', (n) =>
							n.get('/r', () => new Late()).error(inner as any)
						)
						.error(Late, answer)
				)

			const outerFirst =
				(route: (n: AnyElysia) => AnyElysia) => (app: AnyElysia) =>
					app.group('/g', (outer) =>
						outer
							.error(Late, answer)
							.group('/n', (n) =>
								route(n).error(() => status(409, 'inner'))
							)
					)

			const served = {
				innerAnswers: await serve(
					lane,
					nested(() => status(409, 'inner')),
					'/g/n/r'
				),
				innerDeclines: await serve(lane, nested(decline), '/g/n/r'),
				outerFirst: await serve(
					lane,
					outerFirst((n) => n.get('/r', () => new Late())),
					'/g/n/r'
				),
				outerFirstOverLocal: await serve(
					lane,
					outerFirst((n) =>
						n.get(
							'/r',
							{ error: () => status(401, 'local') },
							() => new Late()
						)
					),
					'/g/n/r'
				),
				localOverLaterInner: await serve(
					lane,
					(app) =>
						app.group('/g', (outer) =>
							outer.group('/n', (n) =>
								n
									.get(
										'/r',
										{ error: () => status(401, 'local') },
										() => new Late()
									)
									.error(() => status(409, 'inner'))
							)
						),
					'/g/n/r'
				)
			}

			expect(served).toEqual({
				innerAnswers: '409 inner',
				innerDeclines: '418 late',
				outerFirst: '418 late',
				outerFirstOverLocal: '418 late',
				localOverLaterInner: '401 local'
			})
		})

	// An error hook a macro brings counts the same: it covers the callback's
	// earlier routes too, never the parent's after it (as in Elysia 1.4.30),
	// and the macro's other hooks still reach where they did
	for (const lane of lanes)
		it(`treats a macro's error hook in a callback like the callback's with ${lane.id}`, async () => {
			const served: Record<string, string> = {}
			const ran: string[] = []

			for (const scope of ['local', 'plugin', 'global'] as const) {
				const define = (app: AnyElysia) =>
					app
						.macro({
							rescue: {
								error: () => status(418, 'macro'),
								beforeHandle: ({ path }: any) => {
									ran.push(`${scope} ${path}`)
								}
							}
						})
						.group('/g', (group) =>
							(scope === 'local'
								? group
										.get('/early', () => new Late())
										.guard({
											rescue: true
										} as any)
								: group
										.get('/early', () => new Late())
										.guard(scope, { rescue: true } as any)
							).get('/late', () => new Late())
						)
						.get('/outside', () => new Late())

				for (const path of ['/g/early', '/g/late', '/outside'])
					served[`${scope} ${path}`] = (
						await serve(lane, define, path)
					).slice(0, 3)
			}

			expect(served).toEqual({
				'local /g/early': '418',
				'local /g/late': '418',
				'local /outside': '500',
				'plugin /g/early': '418',
				'plugin /g/late': '418',
				'plugin /outside': '500',
				'global /g/early': '418',
				'global /g/late': '418',
				'global /outside': '500'
			})
			// the macro's other hooks stay inside the callback too
			expect(ran).toEqual([
				'local /g/late',
				'plugin /g/late',
				'global /g/late'
			])
		})

	// Any key may name a macro, a lifecycle event's included: its error hook
	// covers the callback's earlier routes too (as in Elysia 1.4.30), and
	// shows on them
	for (const lane of lanes)
		it(`treats a lifecycle-named macro's error hook in a callback the same with ${lane.id}`, async () => {
			const served: Record<string, string> = {}
			const introspected: Record<string, number> = {}

			for (const key of ['request', 'beforeHandle']) {
				const define = (app: AnyElysia) =>
					app
						.macro({
							[key]: { error: () => status(418, 'macro') }
						} as any)
						.group('/g', (group) =>
							group
								.get('/early', () => new Late())
								.guard({ [key]: true } as any)
								.get('/late', () => new Late())
						)

				for (const path of ['/g/early', '/g/late']) {
					served[`${key} ${path}`] = (
						await serve(lane, define, path)
					).slice(0, 3)
					introspected[`${key} ${path}`] =
						define(new Elysia()).routes.find(
							(route) => route.path === path
						)?.hooks?.error?.length ?? 0
				}
			}

			expect({ served, introspected }).toEqual({
				served: {
					'request /g/early': '418',
					'request /g/late': '418',
					'beforeHandle /g/early': '418',
					'beforeHandle /g/late': '418'
				},
				introspected: {
					'request /g/early': 1,
					'request /g/late': 1,
					'beforeHandle /g/early': 1,
					'beforeHandle /g/late': 1
				}
			})
		})

	for (const lane of lanes)
		it(`keeps a callback's error hook inside the callback with ${lane.id}`, async () => {
			const served: Record<string, string> = {}

			for (const [kind, wrap] of callbacks)
				for (const [scope, add] of callbackHooks)
					served[`${kind}, ${scope}`] = (
						await serve(
							lane,
							(app) =>
								wrap(app, (inner) => add(inner)).get(
									'/outside',
									() => new Late()
								),
							'/outside'
						)
					).slice(0, 3)

			// a plugin is not a callback: its later hook stays off
			served.plugin = (
				await serve(lane, (app) =>
					app.use(
						new Elysia()
							.get('/', () => new Late())
							.error(Late, answer)
					)
				)
			).slice(0, 3)

			expect(served).toEqual(
				Object.fromEntries(Object.keys(served).map((k) => [k, '500']))
			)
		})

	// A route's own `mapResponse` and `afterResponse` still run on its error
	// path, later ones don't
	for (const lane of lanes)
		it(`keeps later map and afterResponse hooks off its error path with ${lane.id}`, async () => {
			const ran: string[] = []
			const map = ({ responseValue }: any) => {
				if (typeof responseValue === 'object')
					return new Response('mapped', { status: 422 })
			}
			const thrown = () => {
				throw status(422, { problem: true })
			}

			const own = await serve(lane, (app) =>
				app
					.mapResponse(map)
					.afterResponse(() => {
						ran.push('own')
					})
					.get('/', thrown)
			)

			const later = await serve(lane, (app) =>
				app
					.get('/', thrown)
					.mapResponse(map)
					.afterResponse(() => {
						ran.push('later')
					})
			)

			await Bun.sleep(10)

			expect({ own, later, ran }).toEqual({
				own: '422 mapped',
				later: '422 {"problem":true}',
				ran: ['own']
			})
		})

	// Registering a non-Error class is a hook too: a route before it keeps
	// serving a returned instance as a value
	for (const lane of lanes)
		it(`keeps a later class registration off an earlier route with ${lane.id}`, async () => {
			class Problem {
				name = 'Problem'
				message = 'problem'
			}

			const define = (handler: () => unknown) => (app: AnyElysia) =>
				app.get('/', handler).error(Problem as any, answer)

			const served = {
				returned: (
					await serve(
						lane,
						define(() => new Problem())
					)
				).slice(0, 3),
				thrown: (
					await serve(
						lane,
						define(() => {
							throw new Problem()
						})
					)
				).slice(0, 3)
			}

			expect(served).toEqual({ returned: '200', thrown: '500' })
		})

	// A static instance of a non-Error class a callback registers is still
	// an error to its routes, the Bun native static table included
	for (const lane of [...lanes, nativeStaticOn])
		it(`keeps a callback's class instance off the native static path with ${lane.id}`, async () => {
			class ValueError {
				message = 'value'
			}

			const served = await serve(
				lane,
				(app) =>
					app.group('/g', (group) =>
						group
							.get('/own', new ValueError() as any)
							.error(ValueError as any, answer)
					),
				'/g/own'
			)

			expect(served).toBe('418 late')
		})

	// A trace registered after the route doesn't see its error either
	for (const lane of lanes)
		for (const [shape, handler] of shapes)
			it(`keeps a later trace off an earlier route's error with ${lane.id}, ${shape}`, async () => {
				const ran: string[] = []

				const served = (
					await serve(lane, (app) =>
						app
							.use(trace())
							.get('/', handler)
							.trace(({ onAfterResponse }) => {
								onAfterResponse(() => {
									ran.push('later')
								})
							})
					)
				).slice(0, 3)

				await Bun.sleep(10)

				expect({ served, ran }).toEqual({ served: '500', ran: [] })
			})
})
