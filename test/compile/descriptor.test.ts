import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import {
	routeDescriptors,
	type RouteDescriptor
} from '../../src/compile/handler/descriptor'
import { resumeEmit } from '../../src/experimental/resume'

// A request compiles the route and publishes the facts used by code generation.

const descriptorOf = async (
	app: Elysia<any, any>,
	key: string,
	req: Request
): Promise<RouteDescriptor> => {
	await app.handle(req)
	const map = routeDescriptors.get(app as any)
	expect(map).toBeDefined()
	const descriptor = map!.get(key)
	expect(descriptor).toBeDefined()
	return descriptor!
}

const get = (path: string) => new Request('http://localhost' + path)

describe('route descriptor', () => {
	it('classifies a bare static value handler', async () => {
		const app = new Elysia({ introspect: true }).get('/s', 'hello')

		const descriptor = await descriptorOf(app, 'GET /s', get('/s'))

		expect(descriptor).toEqual({
			method: 'GET',
			path: '/s',
			handlerKind: 'response',
			async: false,
			responseMode: 'compact',
			contextMode: 'compact',
			headerKeys: [],
			hasBeforeHandle: false,
			hasAfterHandle: false,
			hasMapResponse: false,
			hasAfterResponse: false,
			hasErrorHook: false,
			hasResponseValidator: false,
			hasTrace: false,
			traceCount: 0,
			hasLifecycleHook: false,
			hasBody: false,
			bodyValiIsAsync: false,
			headersValiIsAsync: false,
			paramsValiIsAsync: false,
			queryValiIsAsync: false,
			cookieValiIsAsync: false,
			responseValiAsync: false,
			hasCookieSign: false,
			syncCookieSign: false,
			asyncCookieSign: false,
			lazyCookieVerify: false,
			inferenceSet: false,
			inference: {
				query: false,
				headers: false,
				body: false,
				cookie: false,
				set: false,
				route: false
			},
			handlerIsAsync: false,
			callHandlerSyncOnAsync: false,
			syncErrorHook: false,
			syncAfterResponse: false
		})
	})

	it('selects compact and set Context modes from whole-pipeline effects', async () => {
		const app = new Elysia({ introspect: true })
			.get('/compact', () => 'ok')
			.get('/set', ({ set }) => {
				set.status = 201
				return 'ok'
			})

		const compact = await descriptorOf(app, 'GET /compact', get('/compact'))
		const set = await descriptorOf(app, 'GET /set', get('/set'))

		expect(compact.contextMode).toBe('compact')
		expect(set.contextMode).toBe('set')
	})

	it('records literal header keys and fails open for dynamic reads', async () => {
		const app = new Elysia({ introspect: true })
			.get('/literal', ({ headers: { authorization } }) => authorization)
			.get('/alias', ({ headers: h }) => h.authorization)
			.get('/bracket', ({ headers }) => headers['x-extra'])
			.get(
				'/dynamic',
				({ headers }) => headers[Object.keys({ 'x-extra': true })[0]]
			)

		const request = (path: string) =>
			new Request('http://localhost' + path, {
				headers: { authorization: 'bearer', 'x-extra': 'extra' }
			})

		expect(await (await app.handle(request('/literal'))).text()).toBe(
			'bearer'
		)
		expect(await (await app.handle(request('/alias'))).text()).toBe(
			'bearer'
		)
		expect(await (await app.handle(request('/bracket'))).text()).toBe(
			'extra'
		)
		expect(await (await app.handle(request('/dynamic'))).text()).toBe(
			'extra'
		)

		const descriptors = routeDescriptors.get(app as any)!
		expect(descriptors.get('GET /literal')?.headerKeys).toEqual([
			'authorization'
		])
		expect(descriptors.get('GET /alias')?.headerKeys).toEqual([
			'authorization'
		])
		expect(descriptors.get('GET /bracket')?.headerKeys).toEqual(['x-extra'])
		expect(descriptors.get('GET /dynamic')?.headerKeys).toBeNull()
	})

	for (const [emitter, experimental] of [
		['jit', undefined],
		['resume', { resumeEmit }]
	] as const) {
		it(`${emitter} preserves cookies with partial headers`, async () => {
			const app = new Elysia(experimental ? { experimental } : {}).get(
				'/cookie',
				({ headers: { authorization }, cookie }) =>
					`${authorization}:${cookie.token.value}`
			)
			const response = await app.handle(
				new Request('http://localhost/cookie', {
					headers: {
						authorization: 'bearer',
						cookie: 'token=secret'
					}
				})
			)

			expect(await response.text()).toBe('bearer:secret')
		})

		it(`${emitter} preserves repeated nested header destructuring`, async () => {
			const app = new Elysia(experimental ? { experimental } : {}).get(
				'/headers',
				({ headers: { authorization }, headers: { origin } }) =>
					`${authorization}:${origin}`
			)
			const response = await app.handle(
				new Request('http://localhost/headers', {
					headers: { authorization: 'bearer', origin: 'elysia' }
				})
			)

			expect(await response.text()).toBe('bearer:elysia')
		})
	}

	it('fails open for header reads that cannot preserve full-object semantics', async () => {
		const cases: [string, (context: any) => unknown][] = [
			['computed', ({ headers }) => headers[globalThis.name]],
			['rest', ({ headers: { authorization, ...headers } }) => headers],
			['escape', ({ headers }) => headers],
			['uppercase', ({ headers }) => headers.Authorization],
			['opaque', (context) => Object(context).headers.authorization],
			[
				'redestructured-context',
				(context) => {
					const { headers } = context
					return (
						context.headers.authorization ??
						Object.keys(headers).length
					)
				}
			],
			[
				'context-rest',
				({ ...rest }) => Object(rest).headers.authorization
			],
			['invalid-name', ({ headers }) => headers['not valid']],
			['set-cookie', ({ headers }) => headers['set-cookie']]
		]
		let app = new Elysia({ introspect: true })
		for (const [path, handler] of cases) app = app.get('/' + path, handler)

		for (const [path] of cases) await app.handle(get('/' + path))
		const descriptors = routeDescriptors.get(app as any)!
		for (const [path] of cases)
			expect(descriptors.get(`GET /${path}`)?.headerKeys).toBeNull()
	})

	it('keeps compact error paths safe when response state is materialized late', async () => {
		const app = new Elysia({ introspect: true }).get('/error', () => {
			throw new Error('late')
		})

		const response = await app.handle(get('/error'))
		expect(response.status).toBe(500)
		expect(await response.json()).toMatchObject({
			status: 500,
			detail: 'late'
		})
		expect(
			routeDescriptors.get(app as any)?.get('GET /error')?.contextMode
		).toBe('compact')
	})

	it('classifies a plain synchronous function handler', async () => {
		const app = new Elysia({ introspect: true }).get('/f', () => 'hi')

		const descriptor = await descriptorOf(app, 'GET /f', get('/f'))

		expect(descriptor).toMatchObject({
			handlerKind: 'function',
			async: false,
			handlerIsAsync: false,
			hasLifecycleHook: false
		})
	})

	it('classifies an async function handler', async () => {
		const app = new Elysia({ introspect: true }).get('/a', async () => 'hi')

		const descriptor = await descriptorOf(app, 'GET /a', get('/a'))

		expect(descriptor).toMatchObject({
			handlerKind: 'function',
			async: true,
			handlerIsAsync: true,
			callHandlerSyncOnAsync: false
		})
	})

	it('marks a sync beforeHandle as present without forcing async', async () => {
		const app = new Elysia({ introspect: true }).get(
			'/bh',
			{ beforeHandle: () => {} },
			() => 'hi'
		)

		const descriptor = await descriptorOf(app, 'GET /bh', get('/bh'))

		expect(descriptor).toMatchObject({
			hasBeforeHandle: true,
			hasLifecycleHook: true,
			async: false
		})
	})

	it('forces async through an async beforeHandle', async () => {
		const app = new Elysia({ introspect: true }).get(
			'/bha',
			{ beforeHandle: async () => {} },
			() => 'hi'
		)

		const descriptor = await descriptorOf(app, 'GET /bha', get('/bha'))

		expect(descriptor).toMatchObject({
			hasBeforeHandle: true,
			async: true,
			// the handler itself is sync; only the lifecycle forced async
			handlerIsAsync: false,
			callHandlerSyncOnAsync: true
		})
	})

	it('sees a validated body and forces async parse', async () => {
		const app = new Elysia({ introspect: true }).post(
			'/vb',
			{ body: t.Object({ a: t.String() }) },
			({ body }) => body
		)

		const descriptor = await descriptorOf(
			app,
			'POST /vb',
			new Request('http://localhost/vb', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"a":"x"}'
			})
		)

		expect(descriptor).toMatchObject({
			handlerKind: 'function',
			hasBody: true,
			// body reading is async → the route is async
			async: true,
			bodyValiIsAsync: false
		})
	})

	it('sees a validated query', async () => {
		const app = new Elysia({ introspect: true }).get(
			'/vq',
			{ query: t.Object({ a: t.String() }) },
			({ query }) => query
		)

		const descriptor = await descriptorOf(app, 'GET /vq', get('/vq?a=1'))

		expect(descriptor).toMatchObject({
			hasBody: false,
			async: false,
			queryValiIsAsync: false
		})
	})

	it('sees a validated cookie', async () => {
		const app = new Elysia({ introspect: true }).get(
			'/vc',
			{ cookie: t.Object({ sid: t.String() }) },
			({ cookie }) => cookie.sid.value
		)

		const descriptor = await descriptorOf(
			app,
			'GET /vc',
			new Request('http://localhost/vc', {
				headers: { cookie: 'sid=1' }
			})
		)

		expect(descriptor).toMatchObject({
			hasCookieSign: false
		})
	})

	it('classifies a signed-cookie route', async () => {
		const app = new Elysia({ introspect: true }).get(
			'/sc',
			{
				cookie: t.Cookie(
					{ sid: t.String() },
					{ secrets: 's', sign: ['sid'] }
				)
			},
			({ cookie }) => cookie.sid.value
		)

		const descriptor = await descriptorOf(
			app,
			'GET /sc',
			new Request('http://localhost/sc', {
				headers: { cookie: 'sid=1' }
			})
		)

		expect(descriptor).toMatchObject({
			hasCookieSign: true,
			// node/bun expose a sync HMAC, so signing stays on the sync path
			syncCookieSign: true,
			asyncCookieSign: false
		})
	})

	it('classifies a traced route', async () => {
		const app = new Elysia({ introspect: true })
			.trace(({ onHandle }) => {
				onHandle(() => {})
			})
			.get('/tr', () => 'hi')

		const descriptor = await descriptorOf(app, 'GET /tr', get('/tr'))

		expect(descriptor).toMatchObject({
			hasTrace: true,
			traceCount: 1
		})
	})

	it('classifies an afterResponse route (sync fast path)', async () => {
		const app = new Elysia({ introspect: true }).get(
			'/ar',
			{ afterResponse: () => {} },
			() => 'hi'
		)

		const descriptor = await descriptorOf(app, 'GET /ar', get('/ar'))

		expect(descriptor).toMatchObject({
			hasAfterResponse: true,
			hasLifecycleHook: true,
			async: false,
			// no error hook / trace / async → the sync afterResponse fast path
			syncAfterResponse: true
		})
	})

	it('classifies a mapResponse route', async () => {
		const app = new Elysia({ introspect: true }).get(
			'/mr',
			{ mapResponse: (v: unknown) => v },
			() => 'hi'
		)

		const descriptor = await descriptorOf(app, 'GET /mr', get('/mr'))

		expect(descriptor).toMatchObject({
			hasMapResponse: true,
			hasLifecycleHook: true,
			async: true
		})
	})

	it('classifies a standalone-schema (additive guard) route', async () => {
		const guard = new Elysia().guard('global', {
			schema: 'standalone',
			query: t.Object({ b: t.String() })
		})
		const app = new Elysia({ introspect: true })
			.use(guard)
			.get('/std', { query: t.Object({ a: t.String() }) }, () => 'ok')

		const descriptor = await descriptorOf(
			app,
			'GET /std',
			get('/std?a=1&b=2')
		)

		expect(descriptor).toMatchObject({
			handlerKind: 'function',
			hasBody: false,
			async: false,
			queryValiIsAsync: false
		})
	})

	it('classifies a macro route', async () => {
		const app = new Elysia({ introspect: true })
			.macro({
				hi: (enabled: boolean) => ({
					beforeHandle() {
						if (enabled) {
							/* noop */
						}
					}
				})
			})
			.get('/mac', { hi: true } as any, () => 'ok')

		const descriptor = await descriptorOf(app, 'GET /mac', get('/mac'))

		expect(descriptor).toMatchObject({
			handlerKind: 'function',
			// the macro expanded into a beforeHandle
			hasBeforeHandle: true,
			hasLifecycleHook: true
		})
	})

	it('re-exposes the same descriptor object across requests', async () => {
		const app = new Elysia({ introspect: true }).get('/x', () => 'hi')

		const first = await descriptorOf(app, 'GET /x', get('/x'))
		const second = await descriptorOf(app, 'GET /x', get('/x'))

		// the descriptor is stored once at compile time and not rebuilt per
		// request
		expect(first).toBe(second)
	})
})
