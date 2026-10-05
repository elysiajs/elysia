import { describe, it, expect, afterEach, spyOn } from 'bun:test'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'

import { Elysia, t, status } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { BunAdapter } from '../../src/adapter/bun'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { aot as bunAot } from '../../src/plugin/aot/bun'
import { evalRegistration } from './_manifest'

/**
 * a replayed build must answer like the live JIT of the runtime app; each
 * row's twin replays the build under itself, so replay can't be a no-op
 */

const noop = () => {}
const deny = () => new Response('DENIED', { status: 401 })
const secret = () => 'SECRET'
const user = () => ({ id: 1, password: 'pw' })
const throwing = () => {
	throw new Error('db password=hunter2')
}
const json = (body: unknown): RequestInit => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
})
const log: string[] = []

class Internal {
	constructor(public detail = 'internal') {}
}

const length = (s: string) => s.length
const upper = (s: string) => s.toUpperCase()
const coded = (decode: (s: string) => unknown) =>
	t.Codec(t.String()).Decode(decode).Encode(String)

const bump = ({ responseValue }: any) => {
	if (responseValue && typeof responseValue === 'object') responseValue.n++
}

const sinkless = {
	...BunAdapter,
	response: { ...BunAdapter.response, supportsDefaultHeaderSink: undefined }
} as any

type App = Elysia<any, any, any, any, any, any, any, any>

interface Row {
	why: string
	build: () => App
	runtime: () => App
	requests: Array<[path: string, init?: RequestInit]>
}

const unsigned = { headers: { cookie: 'session=admin' } }

const drifted: Row[] = [
	// a hook the build never saw
	{
		why: 'a beforeHandle appended at runtime denies',
		build: () => new Elysia().get('/s', { beforeHandle: [noop] }, secret),
		runtime: () =>
			new Elysia().get('/s', { beforeHandle: [noop, deny] }, secret),
		requests: [['/s']]
	},
	{
		why: 'a root beforeHandle reaches a route built without hooks',
		build: () => new Elysia().get('/s', secret),
		runtime: () => new Elysia().beforeHandle(deny).get('/s', secret),
		requests: [['/s']]
	},
	{
		why: "a plugin's global beforeHandle reaches a route built without hooks",
		build: () => new Elysia().get('/s', secret),
		runtime: () =>
			new Elysia()
				.use(new Elysia().beforeHandle('global', deny))
				.get('/s', secret),
		requests: [['/s']]
	},
	{
		why: 'a root beforeHandle reaches a static route and a POST route',
		build: () =>
			new Elysia()
				.get('/s', 'SECRET')
				.post('/p', ({ body }: any) => body),
		runtime: () =>
			new Elysia()
				.beforeHandle(deny)
				.get('/s', 'SECRET')
				.post('/p', ({ body }: any) => body),
		requests: [['/s'], ['/p', json({ a: 1 })]]
	},
	{
		why: 'a guard that grows a hook denies',
		build: () =>
			new Elysia().guard({ beforeHandle: noop }, (app) =>
				app.get('/s', secret)
			),
		runtime: () =>
			new Elysia().guard({ beforeHandle: [noop, deny] }, (app) =>
				app.get('/s', secret)
			),
		requests: [['/s']]
	},
	{
		why: 'a macro that expands to one more hook denies',
		build: () =>
			new Elysia()
				.macro({ auth: (_: boolean) => ({ beforeHandle: [noop] }) })
				.get('/s', { auth: true }, secret),
		runtime: () =>
			new Elysia()
				.macro({
					auth: (_: boolean) => ({ beforeHandle: [noop, deny] })
				})
				.get('/s', { auth: true }, secret),
		requests: [['/s']]
	},
	{
		why: 'a transform appended at runtime rejects',
		build: () => new Elysia().get('/s', { transform: [noop] }, secret),
		runtime: () =>
			new Elysia().get(
				'/s',
				{
					transform: [
						noop,
						() => {
							throw status(401, 'DENIED')
						}
					]
				},
				secret
			),
		requests: [['/s']]
	},
	{
		why: 'a rejecting parser added at runtime runs',
		build: () =>
			new Elysia().post(
				'/p',
				{ beforeHandle: [noop] },
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/p',
				{
					beforeHandle: [noop],
					parse: () => {
						throw status(415, 'NOPE')
					}
				},
				({ body }: any) => body
			),
		requests: [['/p', json({ a: 1 })]]
	},
	{
		why: 'an afterHandle added at runtime redacts',
		build: () => new Elysia().get('/u', { beforeHandle: [noop] }, user),
		runtime: () =>
			new Elysia().get(
				'/u',
				{
					beforeHandle: [noop],
					afterHandle: ({ responseValue }: any) => ({
						id: responseValue.id
					})
				},
				user
			),
		requests: [['/u']]
	},
	{
		why: 'a root mapResponse added at runtime redacts',
		build: () => new Elysia().get('/u', user),
		runtime: () =>
			new Elysia()
				.mapResponse(() => new Response('REDACTED'))
				.get('/u', user),
		requests: [['/u']]
	},
	{
		why: 'an afterResponse audit added at runtime runs',
		build: () => new Elysia().get('/s', { beforeHandle: [noop] }, secret),
		runtime: () =>
			new Elysia().get(
				'/s',
				{
					beforeHandle: [noop],
					afterResponse: () => void log.push('audit')
				},
				secret
			),
		requests: [['/s']]
	},
	{
		why: 'a route error hook added at runtime redacts the error',
		build: () => new Elysia().get('/s', { beforeHandle: [noop] }, throwing),
		runtime: () =>
			new Elysia().get(
				'/s',
				{
					beforeHandle: [noop],
					error: () => new Response('REDACTED', { status: 500 })
				},
				throwing
			),
		requests: [['/s']]
	},
	{
		why: "a plugin's own error hook added at runtime redacts the error",
		build: () =>
			new Elysia().use(
				new Elysia().get('/s', { beforeHandle: [noop] }, throwing)
			),
		runtime: () =>
			new Elysia().use(
				new Elysia()
					.error(() => new Response('REDACTED', { status: 500 }))
					.get('/s', { beforeHandle: [noop] }, throwing)
			),
		requests: [['/s']]
	},
	{
		why: 'an error class registered before the route handles it',
		build: () =>
			new Elysia().get(
				'/s',
				{ beforeHandle: [noop] },
				() => new Internal()
			),
		runtime: () =>
			new Elysia()
				// a registered non-Error class: the typed API takes Error subclasses
				.error(Internal as any, () => status(418, 'handled'))
				.get('/s', { beforeHandle: [noop] }, () => new Internal()),
		requests: [['/s']]
	},
	// derive and beforeHandle at the same position
	{
		why: 'a derive prepended at runtime feeds the handler, not the response',
		build: () =>
			new Elysia()
				.beforeHandle(noop)
				.get('/s', (c: any) => 'who=' + c.who),
		runtime: () =>
			new Elysia()
				.derive(() => ({ who: 'alice', token: 'tok' }))
				.beforeHandle(noop)
				.get('/s', (c: any) => 'who=' + c.who),
		requests: [['/s']]
	},
	{
		why: 'a beforeHandle swapped for a derive is not served as the response',
		build: () =>
			new Elysia()
				.beforeHandle(noop)
				.get('/s', (c: any) => 'who=' + c.who),
		runtime: () =>
			new Elysia()
				.derive(() => ({ who: 'alice', token: 'tok' }))
				.get('/s', (c: any) => 'who=' + c.who),
		requests: [['/s']]
	},
	{
		why: 'a derive swapped for a denying beforeHandle denies',
		build: () =>
			new Elysia().derive(() => ({ who: 'a' })).get('/s', secret),
		runtime: () => new Elysia().beforeHandle(deny).get('/s', secret),
		requests: [['/s']]
	},
	// sync at build, async at runtime
	{
		why: 'a transform that became async still rejects',
		build: () => new Elysia().get('/s', { transform: [noop] }, secret),
		runtime: () =>
			new Elysia().get(
				'/s',
				{
					transform: [
						async () => {
							throw status(401, 'DENIED')
						}
					]
				},
				secret
			),
		requests: [['/s']]
	},
	{
		why: 'a beforeHandle that became async still lets the handler run',
		build: () => new Elysia().get('/s', { beforeHandle: [noop] }, secret),
		runtime: () =>
			new Elysia().get('/s', { beforeHandle: [async () => {}] }, secret),
		requests: [['/s']]
	},
	// a validator slot the build never saw
	{
		why: 'a body schema added at runtime validates',
		build: () => new Elysia().post('/b', ({ body }: any) => body),
		runtime: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Number() }) },
				({ body }: any) => body
			),
		requests: [['/b', json({ n: 'x' })]]
	},
	{
		why: 'query, headers and params schemas added at runtime validate',
		build: () =>
			new Elysia()
				.get('/q', ({ query }: any) => query)
				.get('/h', { beforeHandle: [noop] }, () => 'ok')
				.get('/p/:id', ({ params }: any) => params),
		runtime: () =>
			new Elysia()
				.get(
					'/q',
					{ query: t.Object({ token: t.String() }) },
					({ query }: any) => query
				)
				.get(
					'/h',
					{
						beforeHandle: [noop],
						headers: t.Object({ authorization: t.String() })
					},
					() => 'ok'
				)
				.get(
					'/p/:id',
					{ params: t.Object({ id: t.Number() }) },
					({ params }: any) => params
				),
		requests: [['/q'], ['/h'], ['/p/abc'], ['/p/5']]
	},
	{
		why: 'a cookie schema added at runtime validates',
		build: () =>
			new Elysia().get('/c', ({ cookie }: any) =>
				String(cookie.role?.value)
			),
		runtime: () =>
			new Elysia().get(
				'/c',
				{ cookie: t.Cookie({ role: t.Literal('user') }) },
				({ cookie }: any) => String(cookie.role?.value)
			),
		requests: [['/c', { headers: { cookie: 'role=admin' } }]]
	},
	{
		why: 'a response schema added at runtime strips the password',
		build: () => new Elysia().get('/u', user),
		runtime: () =>
			new Elysia().get(
				'/u',
				{ response: t.Object({ id: t.Number() }) },
				user
			),
		requests: [['/u']]
	},
	// the same slot with another schema
	{
		why: 'a tightened body bound is enforced',
		build: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Number() }) },
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Number({ maximum: 10 }) }) },
				({ body }: any) => body
			),
		requests: [['/b', json({ n: 100 })]]
	},
	{
		why: 'a body field made required is enforced',
		build: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Number() }) },
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Number(), token: t.String() }) },
				({ body }: any) => body
			),
		requests: [['/b', json({ n: 1 })]]
	},
	{
		why: 'a refinement added at runtime is enforced',
		build: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Number() }) },
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/b',
				{
					body: t.Object({
						n: t.Refine(t.Number(), (n: number) => n < 10)
					})
				},
				({ body }: any) => body
			),
		requests: [['/b', json({ n: 100 })]]
	},
	{
		why: 'a field removed from the response schema is stripped',
		build: () =>
			new Elysia().get(
				'/u',
				{
					response: t.Object({ id: t.Number(), password: t.String() })
				},
				user
			),
		runtime: () =>
			new Elysia().get(
				'/u',
				{ response: t.Object({ id: t.Number() }) },
				user
			),
		requests: [['/u']]
	},
	{
		why: 'a query field retyped at runtime validates and coerces',
		build: () =>
			new Elysia().get(
				'/q',
				{ query: t.Object({ n: t.String() }) },
				({ query }: any) => ({ n: query.n })
			),
		runtime: () =>
			new Elysia().get(
				'/q',
				{ query: t.Object({ n: t.Number() }) },
				({ query }: any) => ({ n: query.n })
			),
		requests: [['/q?n=abc'], ['/q?n=5']]
	},
	{
		why: 'a guard schema tightened at runtime is enforced',
		build: () =>
			new Elysia().guard({ query: t.Object({ a: t.String() }) }, (app) =>
				app.get('/g', ({ query }: any) => query)
			),
		runtime: () =>
			new Elysia().guard(
				{ query: t.Object({ a: t.String(), token: t.String() }) },
				(app) => app.get('/g', ({ query }: any) => query)
			),
		requests: [['/g?a=1']]
	},
	{
		why: 'a schema default changed at runtime applies',
		build: () =>
			new Elysia().get(
				'/q',
				{ query: t.Object({ admin: t.Boolean({ default: true }) }) },
				({ query }: any) => query
			),
		runtime: () =>
			new Elysia().get(
				'/q',
				{ query: t.Object({ admin: t.Boolean({ default: false }) }) },
				({ query }: any) => query
			),
		requests: [['/q']]
	},
	{
		why: 'a default changed from 0 to -0 at runtime applies',
		build: () =>
			new Elysia().get(
				'/q',
				{ query: t.Object({ n: t.Number({ default: 0 }) }) },
				({ query }: any) => (Object.is(query.n, -0) ? '-0' : 'n')
			),
		runtime: () =>
			new Elysia().get(
				'/q',
				{ query: t.Object({ n: t.Number({ default: -0 }) }) },
				({ query }: any) => (Object.is(query.n, -0) ? '-0' : 'n')
			),
		requests: [['/q']]
	},
	{
		why: 'a model changed at runtime validates through its name',
		build: () =>
			new Elysia()
				.model({ B: t.Object({ n: t.Number() }) })
				.post('/b', { body: 'B' }, ({ body }: any) => body),
		runtime: () =>
			new Elysia()
				.model({ B: t.Object({ n: t.Number({ maximum: 10 }) }) })
				.post('/b', { body: 'B' }, ({ body }: any) => body),
		requests: [['/b', json({ n: 100 })]]
	},
	{
		why: 'a model changed at runtime validates through another model',
		build: () =>
			new Elysia()
				.model({ N: t.Number(), B: t.Object({ n: t.Ref('N') }) })
				.post('/b', { body: 'B' }, ({ body }: any) => body),
		runtime: () =>
			new Elysia()
				.model({
					N: t.Number({ maximum: 10 }),
					B: t.Object({ n: t.Ref('N') })
				})
				.post('/b', { body: 'B' }, ({ body }: any) => body),
		requests: [['/b', json({ n: 100 })]]
	},
	{
		why: 'a model changed at runtime redacts through a status map',
		build: () =>
			new Elysia()
				.model({
					U: t.Object({ id: t.Number(), password: t.String() })
				})
				.get('/u', { response: { 200: 'U' } }, user),
		runtime: () =>
			new Elysia()
				.model({ U: t.Object({ id: t.Number() }) })
				.get('/u', { response: { 200: 'U' } }, user),
		requests: [['/u']]
	},
	// config the emission reads
	{
		why: 'cookie signing turned on at runtime rejects an unsigned cookie',
		build: () =>
			new Elysia().get(
				'/c',
				{ cookie: t.Cookie({ session: t.Optional(t.String()) }) },
				({ cookie }: any) => 'session=' + cookie.session.value
			),
		runtime: () =>
			new Elysia({ cookie: { secrets: 'k3y', sign: ['session'] } }).get(
				'/c',
				{ cookie: t.Cookie({ session: t.Optional(t.String()) }) },
				({ cookie }: any) => 'session=' + cookie.session.value
			),
		requests: [['/c', unsigned]]
	},
	{
		why: 'cookie signing turned on at runtime signs what the handler sets',
		build: () =>
			new Elysia().get('/w', ({ cookie }: any) => {
				cookie.session.value = 'u1'
				return 'ok'
			}),
		runtime: () =>
			new Elysia({ cookie: { secrets: 'k3y', sign: ['session'] } }).get(
				'/w',
				({ cookie }: any) => {
					cookie.session.value = 'u1'
					return 'ok'
				}
			),
		requests: [['/w']]
	},
	{
		why: 'default security headers added at runtime are sent',
		build: () =>
			new Elysia()
				.get('/s', secret)
				.get('/h', { beforeHandle: [noop] }, secret),
		runtime: () =>
			new Elysia()
				.headers({ 'x-frame-options': 'DENY' })
				.get('/s', secret)
				.get('/h', { beforeHandle: [noop] }, secret),
		requests: [['/s'], ['/h']]
	},
	{
		why: 'normalize turned on at runtime strips the response',
		build: () =>
			new Elysia({ normalize: false }).get(
				'/u',
				{ response: t.Object({ id: t.Number() }) },
				user
			),
		runtime: () =>
			new Elysia().get(
				'/u',
				{ response: t.Object({ id: t.Number() }) },
				user
			),
		requests: [['/u']]
	},
	{
		why: 'unsafe validation details turned off at runtime stay off',
		build: () =>
			new Elysia({ allowUnsafeValidationDetails: true }).post(
				'/b',
				{ body: t.Object({ n: t.Number() }), error: [() => undefined] },
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Number() }), error: [() => undefined] },
				({ body }: any) => body
			),
		requests: [['/b', json({ n: 'secret-value' })]]
	},
	{
		// collided under an earlier canonical string
		why: 'a body bound changed alongside its description is enforced',
		build: () =>
			new Elysia().post(
				'/b',
				{
					body: t.Number({
						maximum: 14203,
						description: '1psej81ayj'
					})
				},
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/b',
				{
					body: t.Number({ maximum: 9134, description: '150iake71q' })
				},
				({ body }: any) => body
			),
		requests: [['/b', json(10000)]]
	},
	{
		why: 'a static value turned into an object is cloned per request',
		// a response schema keeps the static value unmapped until the request
		build: () =>
			new Elysia().get(
				'/s',
				{ afterHandle: bump, response: t.Any() },
				'static' as any
			),
		runtime: () =>
			new Elysia().get(
				'/s',
				{ afterHandle: bump, response: t.Any() },
				{ n: 0 }
			),
		requests: [['/s'], ['/s']]
	},
	{
		why: 'abort handling turned on at runtime stops an aborted request',
		build: () =>
			new Elysia({ abortSignal: false }).get(
				'/s',
				{ beforeHandle: [() => void log.push('ran')] },
				secret
			),
		runtime: () =>
			new Elysia().get(
				'/s',
				{ beforeHandle: [() => void log.push('ran')] },
				secret
			),
		requests: [['/s', { signal: AbortSignal.abort() }]]
	},
	{
		why: 'an adapter without the default header sink keeps the headers',
		build: () =>
			new Elysia()
				.headers({ 'x-frame-options': 'DENY' })
				.get('/s', ({ set }: any) => {
					set.status = 201
					return 'SECRET'
				}),
		runtime: () =>
			new Elysia({ adapter: sinkless })
				.headers({ 'x-frame-options': 'DENY' })
				.get('/s', ({ set }: any) => {
					set.status = 201
					return 'SECRET'
				}),
		requests: [['/s']]
	},
	{
		why: 'a decoder no longer shared between two fields decodes its own',
		build: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ a: coded(length), b: coded(length) }) },
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ a: coded(length), b: coded(upper) }) },
				({ body }: any) => body
			),
		requests: [['/b', json({ a: 'xy', b: 'xy' })]]
	},
	{
		why: 'a constraint behind an accessor is read as registered',
		build: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: accessorMaximum(100) }) },
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: accessorMaximum(10) }) },
				({ body }: any) => body
			),
		requests: [['/b', json({ n: 50 })]]
	}
]

// schemas whose frozen check can't be proven equal never replay
const inheritedMaximum = (maximum: number) =>
	Object.defineProperty(
		Object.assign(Object.create({ maximum }), { type: 'number' }),
		'~kind',
		{ value: 'Number' }
	)
const accessorMaximum = (maximum: number) =>
	Object.defineProperty(
		Object.defineProperty({ type: 'number' }, '~kind', { value: 'Number' }),
		'maximum',
		{ get: () => maximum, enumerable: true }
	)

const unprovable: Row[] = [
	{
		why: 'a constraint inherited from a foreign prototype',
		build: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: inheritedMaximum(100) }) },
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: inheritedMaximum(10) }) },
				({ body }: any) => body
			),
		requests: [['/b', json({ n: 50 })]]
	}
]

// replay reads these at runtime, so the build's route is kept
const benign: Row[] = [
	{
		why: 'a refinement function rewritten at runtime',
		build: () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Refine(t.Number(), () => true) }) },
				({ body }: any) => body
			),
		runtime: () =>
			new Elysia().post(
				'/b',
				{
					body: t.Object({
						n: t.Refine(t.Number(), (n: number) => n < 10)
					})
				},
				({ body }: any) => body
			),
		requests: [['/b', json({ n: 100 })]]
	},
	{
		why: 'a rotated cookie secret, domain and path',
		build: () =>
			new Elysia({
				cookie: {
					secrets: 'build',
					sign: ['session'],
					domain: 'a.test'
				}
			}).get(
				'/c',
				{
					cookie: t.Cookie(
						{
							session: t.Optional(t.String()),
							theme: t.Cookie(t.Optional(t.String()), {
								secrets: 'build-field',
								domain: 'a.test'
							})
						},
						{ secrets: 'build-route', path: '/a' }
					)
				},
				({ cookie }: any) => 'session=' + cookie.session.value
			),
		runtime: () =>
			new Elysia({
				cookie: {
					secrets: 'runtime',
					sign: ['session'],
					domain: 'b.test'
				}
			}).get(
				'/c',
				{
					cookie: t.Cookie(
						{
							session: t.Optional(t.String()),
							theme: t.Cookie(t.Optional(t.String()), {
								secrets: 'runtime-field',
								domain: 'b.test'
							})
						},
						{ secrets: 'runtime-route', path: '/b' }
					)
				},
				({ cookie }: any) => 'session=' + cookie.session.value
			),
		requests: [['/c', unsigned]]
	},
	{
		why: 'a rotated secret in a cookie model',
		build: () =>
			new Elysia()
				.model({
					Session: t.Cookie(
						{ session: t.Optional(t.String()) },
						{ secrets: 'build-model' }
					)
				})
				.get(
					'/c',
					{ cookie: 'Session' },
					({ cookie }: any) => 'session=' + cookie.session.value
				),
		runtime: () =>
			new Elysia()
				.model({
					Session: t.Cookie(
						{ session: t.Optional(t.String()) },
						{ secrets: 'runtime-model' }
					)
				})
				.get(
					'/c',
					{ cookie: 'Session' },
					({ cookie }: any) => 'session=' + cookie.session.value
				),
		requests: [['/c', unsigned]]
	}
]

async function serve(app: App, requests: Row['requests']) {
	const out: unknown[] = []
	for (const [path, init] of requests) {
		log.length = 0
		const response = await app.handle(
			new Request('http://localhost' + path, init)
		)
		const body = await response.text()
		// afterResponse runs in a microtask
		await Bun.sleep(0)
		out.push({
			path,
			status: response.status,
			body,
			frame: response.headers.get('x-frame-options'),
			cookie: response.headers.get('set-cookie'),
			log: log.join()
		})
	}
	return out
}

/** capture `build` like an AOT plugin: built with `ELYSIA_AOT_BUILD`, which skips interning */
async function capture(build: () => App) {
	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		return await captureArtifacts(build())
	} finally {
		delete process.env.ELYSIA_AOT_BUILD
	}
}

/** replay `build` under `runtime`, count frozen factory calls */
async function replay(build: () => App, runtime: () => App) {
	const { source } = await capture(build)
	const registration = evalRegistration(source)

	let factoryCalls = 0
	for (const method in registration.handlers)
		for (const path in registration.handlers[method]) {
			const record = registration.handlers[method]![path]!
			const factory = record.f
			if (factory)
				registration.handlers[method]![path] = {
					...record,
					f: (...args: unknown[]) => {
						factoryCalls++
						return factory(...args)
					}
				}
		}

	Compiled.clear()
	Validator.clear()
	Compiled.register(registration)

	const warn = spyOn(console, 'warn').mockImplementation(() => {})
	let app: App
	let warnings: string[]
	try {
		app = runtime()
		app.compile()
	} finally {
		warnings = warn.mock.calls.map((call) => String(call[0]))
		warn.mockRestore()
	}

	return { app, factoryCalls, warnings }
}

async function live(runtime: () => App, requests: Row['requests']) {
	Compiled.clear()
	Validator.clear()
	const app = runtime()
	app.compile()
	return serve(app, requests)
}

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

describe('AOT replay of a route that differs from the build', () => {
	for (const row of drifted)
		it(row.why, async () => {
			// twin: the build replays under itself
			const twin = await replay(row.build, row.build)
			expect(twin.factoryCalls).toBeGreaterThan(0)
			expect(twin.warnings).toEqual([])

			const replayed = await replay(row.build, row.runtime)
			const answered = await serve(replayed.app, row.requests)

			expect(answered).toEqual(await live(row.runtime, row.requests))
			// the build's frozen route is never served for it
			expect(replayed.factoryCalls).toBe(0)
			expect(replayed.warnings.length).toBeGreaterThan(0)
			for (const warning of replayed.warnings)
				expect(warning).toContain('differs from the AOT build')
		})

	for (const row of benign)
		it(`still replays after ${row.why}`, async () => {
			const replayed = await replay(row.build, row.runtime)
			const answered = await serve(replayed.app, row.requests)

			expect(answered).toEqual(await live(row.runtime, row.requests))
			expect(replayed.factoryCalls).toBeGreaterThan(0)
			expect(replayed.warnings).toEqual([])
		})

	for (const row of unprovable)
		it(`never replays ${row.why}`, async () => {
			for (const runtime of [row.build, row.runtime]) {
				const replayed = await replay(row.build, runtime)
				const answered = await serve(replayed.app, row.requests)

				expect(answered).toEqual(await live(runtime, row.requests))
				expect(replayed.factoryCalls).toBe(0)
				expect(replayed.warnings.length).toBe(1)
			}
		})

	it('replays an app whose equal schemas are shared only at runtime', async () => {
		const app = () =>
			new Elysia().post(
				'/b',
				{
					body: t.Object({ n: t.Number() }),
					query: t.Object({ n: t.Number() })
				},
				({ body }: any) => body
			)
		const requests: Row['requests'] = [['/b?n=1', json({ n: 2 })]]

		const replayed = await replay(app, app)

		expect(await serve(replayed.app, requests)).toEqual(
			await live(app, requests)
		)
		expect(replayed.factoryCalls).toBeGreaterThan(0)
		expect(replayed.warnings).toEqual([])
	})

	// runtime interning must not merge build-distinct schemas, or the app stops replaying
	it('replays an app whose schemas differ only by a -0 default', async () => {
		const app = () =>
			new Elysia().post(
				'/b',
				{
					body: t.Object({ n: t.Number({ default: -0 }) }),
					query: t.Object({ n: t.Number({ default: 0 }) })
				},
				({ body }: any) => body
			)
		const requests: Row['requests'] = [['/b?n=1', json({ n: 2 })]]

		const replayed = await replay(app, app)

		expect(await serve(replayed.app, requests)).toEqual(
			await live(app, requests)
		)
		expect(replayed.factoryCalls).toBeGreaterThan(0)
		expect(replayed.warnings).toEqual([])
	})

	it('keeps cookie secrets out of the manifest', async () => {
		const { source } = await capture(benign[1]!.build)

		expect(source).not.toContain('build-route')
		expect(source).not.toContain('build-field')
		expect(source).not.toContain('a.test')
	})

	it('warns once per route, naming it', async () => {
		const row = drifted[0]!
		const replayed = await replay(row.build, row.runtime)

		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		let later: string[]
		try {
			await serve(replayed.app, [...row.requests, ...row.requests])
			replayed.app.compile()
		} finally {
			later = warn.mock.calls.map((call) => String(call[0]))
			warn.mockRestore()
		}

		expect(later).toEqual([])
		expect(replayed.warnings).toEqual([
			'[elysia-aot] GET /s differs from the AOT build, compiled at runtime'
		])
	})

	it('stores the shape as a stable numeric hash', async () => {
		const row = drifted.find((row) => row.why.includes('description'))!
		const shape = async (app: () => App) =>
			evalRegistration((await capture(app)).source).handlers!.POST!['/b']!
				.k

		const build = await shape(row.build)
		expect(build).toBeTypeOf('number')
		expect(await shape(row.build)).toBe(build)
		expect(await shape(row.runtime)).not.toBe(build)
	})

	it('never replays a route record without a shape', async () => {
		const row = drifted[0]!
		const { source } = await capture(row.runtime)
		const registration = evalRegistration(source)
		const record = registration.handlers!.GET!['/s']!
		let factoryCalls = 0
		registration.handlers!.GET!['/s'] = {
			a: record.a,
			f: (...args: unknown[]) => {
				factoryCalls++
				return record.f!(...args)
			}
		} as any

		Compiled.clear()
		Compiled.register(registration)
		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		try {
			const app = row.runtime()
			app.compile()
			expect((await app.handle('/s')).status).toBe(401)
		} finally {
			warn.mockRestore()
		}

		expect(factoryCalls).toBe(0)
	})

	it('never replays while a built-in prototype carries enumerable state', async () => {
		const app = () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Number() }) },
				({ body }: any) => body
			)
		const requests: Row['requests'] = [['/b', json({ n: 50 })]]

		try {
			// every schema inherits it: the build's check never saw it
			const replayed = await replay(app, () => {
				;(Object.prototype as any).maximum = 10
				return app()
			})
			const answered = await serve(replayed.app, requests)

			expect(answered).toEqual(await live(app, requests))
			expect(replayed.factoryCalls).toBe(0)
		} finally {
			delete (Object.prototype as any).maximum
		}
	})

	it('never replays the validators of a route without a record', async () => {
		const app = (maximum: number) => () =>
			new Elysia().post(
				'/b',
				{ body: t.Object({ n: t.Number({ maximum }) }) },
				({ body }: any) => body
			)
		const { source } = await capture(app(100))
		const registration = evalRegistration(source)
		delete registration.handlers!.POST!['/b']

		Compiled.clear()
		Validator.clear()
		Compiled.register(registration)
		const replayed = app(10)()
		replayed.compile()

		expect(
			(await replayed.handle('/b', json({ n: 50 }) as any)).status
		).toBe(422)
	})

	it('rejects a manifest from the format before route shapes', async () => {
		const row = drifted[0]!
		const { source } = await capture(row.build)
		const registration = evalRegistration(source)
		const [version] = registration.fingerprint.abi.split(':')

		Compiled.clear()
		Compiled.register({
			...registration,
			fingerprint: { abi: `${version}:5` }
		})

		expect(() => row.runtime().compile()).toThrow('Mismatch fingerprint')
	})
})

describe('AOT replay of a WebSocket route that differs from the build', () => {
	const ws = (bound: boolean, leak: boolean) => () =>
		new Elysia().use(websocket()).ws('/ws', {
			body: t.Object({
				n: bound ? t.Number({ maximum: 10 }) : t.Number()
			}),
			response: leak
				? t.Object({ id: t.Number(), password: t.String() })
				: t.Object({ id: t.Number() }),
			message(socket: any, body: any) {
				socket.send({ id: body.n, password: 'pw' })
			}
		}) as App

	const talk = async (app: App) => {
		app.listen(0)
		const socket = new WebSocket(`ws://localhost:${app.server!.port}/ws`)
		await new Promise((done) => (socket.onopen = done))

		const received: string[] = []
		const closed = new Promise((done) => (socket.onclose = done))
		socket.onmessage = (event) => {
			received.push(String(event.data))
			if (received.length === 2) socket.close()
		}
		socket.send(JSON.stringify({ n: 100 }))
		socket.send(JSON.stringify({ n: 5 }))
		await closed
		await app.stop()

		return received.map((message) => {
			const parsed = JSON.parse(message)
			return parsed.status ?? parsed
		})
	}

	const replayWS = async (build: () => App, runtime: () => App) => {
		const { source } = await capture(build)
		const registration = evalRegistration(source)

		Compiled.clear()
		Validator.clear()
		Compiled.register(registration)

		const getValidator = Compiled.getValidator
		let frozenHits = 0
		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		const spy = spyOn(Compiled, 'getValidator').mockImplementation(
			(...args: Parameters<typeof getValidator>) => {
				const frozen = getValidator.apply(Compiled, args)
				if (args[0] === 'WS' && frozen) frozenHits++
				return frozen
			}
		)
		let warnings: string[]
		let received: unknown[]
		try {
			received = await talk(runtime())
		} finally {
			warnings = warn.mock.calls.map((call) => String(call[0]))
			warn.mockRestore()
			spy.mockRestore()
		}

		return { received, frozenHits, warnings }
	}

	it('enforces a tightened message schema and a redacting response schema', async () => {
		const twin = await replayWS(ws(false, true), ws(false, true))
		expect(twin.frozenHits).toBeGreaterThan(0)
		expect(twin.warnings).toEqual([])

		const replayed = await replayWS(ws(false, true), ws(true, false))

		Compiled.clear()
		Validator.clear()
		expect(replayed.received).toEqual(await talk(ws(true, false)()))
		expect(replayed.received).toContainEqual({ id: 5 })
		expect(replayed.frozenHits).toBe(0)
		expect(replayed.warnings).toEqual([
			'[elysia-aot] WS /ws differs from the AOT build, compiled at runtime'
		])
	})
})

describe('stripped AOT bundle of an app that differs at runtime', () => {
	const ENTRY = 'test/aot/fixtures/replay-drift-app.ts'
	const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
	const loaded: string[] = []

	afterEach(async () => {
		delete process.env.REPLAY_DRIFT
		for (const file of loaded.splice(0)) await rm(file, { force: true })
	})

	// a fresh module graph per load: the bundle reads REPLAY_DRIFT on import
	const load = async (text: string, drift: boolean) => {
		const file = resolve(
			import.meta.dir,
			`_replay-drift.${Date.now()}.${Math.random().toString(36).slice(2)}.mjs`
		)
		loaded.push(file)
		await Bun.write(file, text)

		if (drift) process.env.REPLAY_DRIFT = '1'
		else delete process.env.REPLAY_DRIFT

		return (await import(file)).app as App
	}

	it('serves the build, and fails closed instead of the build when the runtime differs', async () => {
		delete process.env.REPLAY_DRIFT
		const result = await Bun.build({
			entrypoints: [ENTRY],
			plugins: [
				bunAot(ENTRY, { registerFrom: REGISTER_FROM, strip: true })
			],
			target: 'bun'
		})
		expect(result.success).toBe(true)
		const text = await result.outputs[0]!.text()
		expect(text).toContain('handler compiler JIT was stripped')

		const same = await load(text, false)
		expect(await (await same.handle('/secret')).text()).toBe('SECRET')

		// lazy: the route fails closed on its first request
		const lazy = await load(text, true)
		const secret = await lazy.handle('/secret')
		expect(secret.status).toBe(500)
		expect(await secret.text()).not.toContain('SECRET')
		const body = await lazy.handle('/body', json({ n: 100 }) as any)
		expect(body.status).toBe(500)

		// eager: the app does not boot
		const eager = await load(text, true)
		expect(() => eager.compile()).toThrow(
			'[elysia-aot] GET /secret differs from the AOT build'
		)
	})
})
