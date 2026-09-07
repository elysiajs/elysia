// Each case gets a fresh app and requests. `safe-for-socket` enables socket
// lanes, `handle-only` excludes them, and `observe` records hook order.

import {
	Elysia,
	t,
	status,
	redirect,
	sse,
	file,
	type AnyElysia
} from '../../src'
import { autoHead } from '../../src/plugin/auto-head'

export interface CorpusRequest {
	id: string
	make: () => Request
	tags?: string[]
	// Lane pairs to skip.
	excludeLanePairs?: string[]
}

export interface CorpusEntry {
	id: string
	tags: string[]
	define: (app: AnyElysia) => AnyElysia
	requests: CorpusRequest[]
}

const url = (path: string) => `http://localhost${path}`
const get = (path: string) => () => new Request(url(path))
const json = (path: string, body: unknown) => () =>
	new Request(url(path), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})

export interface Recorder {
	events: string[]
	reset(): void
}

export const makeRecorder = (): Recorder => ({
	events: [],
	reset() {
		this.events = []
	}
})

export interface ObservableCorpusEntry extends CorpusEntry {
	recorder?: Recorder
}

const makeThenable = (value: unknown) => ({
	then(resolve: (v: unknown) => void) {
		resolve(value)
	}
})

const makeThrowingThenGetter = () => {
	const obj = {} as Record<string, unknown>
	Object.defineProperty(obj, 'then', {
		configurable: true,
		enumerable: true,
		get() {
			throw new Error('then-getter-boom')
		}
	})
	return obj
}

export const corpus: ObservableCorpusEntry[] = []

corpus.push({
	id: 'native-static-literal',
	tags: ['safe-for-socket', 'static', 'native-static'],
	define: (app) => app.get('/native/literal', 'literal'),
	requests: [{ id: 'literal', make: get('/native/literal') }]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'native-static-after-response',
		tags: ['safe-for-socket', 'static', 'observe', 'native-static'],
		recorder,
		define: (app) =>
			app.get(
				'/native/after-response',
				{
					afterResponse() {
						recorder.events.push('afterResponse')
					}
				},
				'literal'
			),
		requests: [
			{ id: 'after-response', make: get('/native/after-response') }
		]
	})
}

// Error hooks do not run on promoted static routes.
corpus.push({
	id: 'native-static-error-hook',
	tags: ['safe-for-socket', 'static', 'error', 'native-static'],
	define: (app) =>
		app
			.headers({ 'x-static': 'promoted' })
			.error(() => {})
			.get('/native/error-hook', 'literal'),
	requests: [
		{ id: 'literal', make: get('/native/error-hook') },
		{ id: 'miss', make: get('/native/error-hook/missing') }
	]
})

corpus.push({
	id: 'native-static-all',
	tags: ['safe-for-socket', 'static', 'method', 'native-static'],
	define: (app) => app.all('/native/all', 'all-literal'),
	requests: [
		{ id: 'get', make: get('/native/all') },
		{
			id: 'report',
			make: () => new Request(url('/native/all'), { method: 'REPORT' })
		}
	]
})

corpus.push({
	id: 'native-static-request-hook',
	tags: ['safe-for-socket', 'static', 'lifecycle', 'native-static'],
	define: (app) =>
		app.get(
			'/native/request-hook',
			{
				mapResponse({ request }) {
					return new Response(
						request.headers.get('x-value') ?? 'missing'
					)
				}
			},
			'literal'
		),
	requests: [
		{
			id: 'one',
			make: () =>
				new Request(url('/native/request-hook'), {
					headers: { 'x-value': 'one' }
				})
		},
		{
			id: 'two',
			make: () =>
				new Request(url('/native/request-hook'), {
					headers: { 'x-value': 'two' }
				})
		}
	]
})

corpus.push({
	id: 'static',
	tags: ['safe-for-socket', 'static'],
	define: (app) =>
		app
			.get('/', () => 'root')
			.get('/health', () => 'ok')
			.get('/api/v1/status', () => 'nested-static'),
	requests: [
		{ id: 'root', make: get('/') },
		{ id: 'health', make: get('/health') },
		{ id: 'nested', make: get('/api/v1/status') }
	]
})

corpus.push({
	id: 'default-headers',
	tags: ['safe-for-socket', 'headers', 'default-headers'],
	define: (app) =>
		app
			.headers({ 'x-app-default': 'base', 'x-shared': 'default' })
			.get('/headers/default', () => 'untouched')
			.get('/headers/patched', ({ set }) => {
				set.headers['x-shared'] = 'route'
				return 'patched'
			}),
	requests: [
		{ id: 'untouched', make: get('/headers/default') },
		{ id: 'request-local-patch', make: get('/headers/patched') }
	]
})

corpus.push({
	id: 'params',
	tags: ['safe-for-socket', 'param'],
	define: (app) =>
		app
			.get('/user/:id', ({ params }: any) => `id:${params.id}`)
			.get('/user/:id/post/:postId', ({ params }: any) => ({
				user: params.id,
				post: params.postId
			})),
	requests: [
		{ id: 'single', make: get('/user/42') },
		{ id: 'multi', make: get('/user/7/post/99') }
	]
})

corpus.push({
	id: 'param-encoding',
	tags: ['safe-for-socket', 'param', 'unicode'],
	define: (app) => app.get('/echo/:v', ({ params }: any) => params.v),
	requests: [
		{
			id: 'thai',
			make: get(
				'/echo/%E0%B8%AA%E0%B8%A7%E0%B8%B1%E0%B8%AA%E0%B8%94%E0%B8%B5'
			)
		},
		{ id: 'emoji', make: get('/echo/%F0%9F%9A%80') },
		{ id: 'reserved', make: get('/echo/a%2Fb%20c') }
	]
})

corpus.push({
	id: 'wildcard',
	tags: ['safe-for-socket', 'wildcard'],
	define: (app) => app.get('/files/*', ({ params }: any) => params['*']),
	requests: [
		{ id: 'single-seg', make: get('/files/readme.txt') },
		{ id: 'deep', make: get('/files/a/b/c.png') },
		{ id: 'empty', make: get('/files/') }
	]
})

corpus.push({
	id: 'optional-nontail',
	tags: ['safe-for-socket', 'param', 'optional'],
	define: (app) =>
		app.get('/a/:b?/c', ({ params }: any) => `b=${params.b ?? 'none'}`),
	requests: [
		{ id: 'present', make: get('/a/x/c') },
		{ id: 'absent', make: get('/a/c') }
	]
})

corpus.push({
	id: 'trailing-slash',
	tags: ['safe-for-socket', 'path'],
	define: (app) => app.get('/loose', () => 'loose'),
	requests: [
		{ id: 'no-slash', make: get('/loose') },
		{ id: 'trailing-slash', make: get('/loose/') }
	]
})

corpus.push({
	id: 'precedence',
	tags: ['safe-for-socket', 'param', 'precedence'],
	define: (app) =>
		app
			.get('/u/me', () => 'me-literal')
			.get('/u/:id', ({ params }: any) => `id:${params.id}`),
	requests: [
		{ id: 'literal-wins', make: get('/u/me') },
		{ id: 'param-fallback', make: get('/u/42') }
	]
})

corpus.push({
	id: 'duplicate-route-static',
	tags: ['safe-for-socket', 'precedence'],
	define: (app) => app.get('/dup', () => 'first').get('/dup', () => 'second'),
	requests: [{ id: 'static-last-wins', make: get('/dup') }]
})

corpus.push({
	id: 'duplicate-route-dynamic',
	tags: ['safe-for-socket', 'precedence'],
	define: (app) =>
		app.get('/dup/:id', () => 'first').get('/dup/:id', () => 'second'),
	requests: [{ id: 'dynamic-last-wins', make: get('/dup/1') }]
})

corpus.push({
	id: 'all-method',
	tags: ['safe-for-socket', 'method'],
	define: (app) =>
		app.all('/any', ({ request }: any) => `m=${request.method}`),
	requests: [
		{ id: 'get', make: () => new Request(url('/any')) },
		{
			id: 'delete',
			make: () => new Request(url('/any'), { method: 'DELETE' })
		},
		{
			id: 'custom-report',
			make: () => new Request(url('/any'), { method: 'REPORT' })
		}
	]
})

corpus.push({
	id: 'query-scalar',
	tags: ['safe-for-socket', 'query', 'schema'],
	define: (app) =>
		app.get(
			'/q',
			{ query: t.Object({ n: t.Number(), b: t.Boolean() }) },
			({ query }) => query
		),
	requests: [
		{ id: 'valid', make: get('/q?n=5&b=true') },
		{ id: 'coerce-false', make: get('/q?n=0&b=false') },
		{ id: 'invalid-n', make: get('/q?n=abc&b=true') },
		{ id: 'missing', make: get('/q') }
	]
})

corpus.push({
	id: 'query-object',
	tags: ['safe-for-socket', 'query', 'schema'],
	define: (app) =>
		app.get(
			'/qo',
			{
				query: t.Object({
					filter: t.Object({ min: t.Numeric(), max: t.Numeric() })
				})
			},
			({ query }) => query
		),
	requests: [
		{
			id: 'object-in-query',
			make: get('/qo?filter=' + encodeURIComponent('{"min":1,"max":9}'))
		},
		{
			id: 'extra-key',
			make: get(
				'/qo?filter=' +
					encodeURIComponent('{"min":1,"max":9}') +
					'&extra=ignored'
			)
		}
	]
})

corpus.push({
	id: 'json-body',
	tags: ['safe-for-socket', 'body', 'schema'],
	define: (app) =>
		app.post(
			'/echo',
			{ body: t.Object({ n: t.Number(), s: t.String() }) },
			({ body }) => body
		),
	requests: [
		{ id: 'valid', make: json('/echo', { n: 1, s: 'a' }) },
		{ id: 'invalid-422', make: json('/echo', { n: 'x', s: 'a' }) },
		{
			id: 'wrong-content-type',
			make: () =>
				new Request(url('/echo'), {
					method: 'POST',
					headers: { 'content-type': 'text/plain' },
					body: JSON.stringify({ n: 1, s: 'a' })
				})
		},
		{
			id: 'malformed-json',
			make: () =>
				new Request(url('/echo'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{"n":1,'
				})
		},
		{
			id: 'no-content-type',
			make: () =>
				new Request(url('/echo'), { method: 'POST', body: 'hello' })
		},
		{
			id: 'empty-json-body',
			make: () =>
				new Request(url('/echo'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: ''
				})
		},
		{
			id: 'proto-key',
			make: () =>
				new Request(url('/echo'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{"n":1,"s":"a","__proto__":{"polluted":true}}'
				})
		}
	]
})

corpus.push({
	id: 'multipart-form',
	tags: ['safe-for-socket', 'body', 'form'],
	define: (app) =>
		app.post(
			'/form',
			{ body: t.Object({ name: t.String(), age: t.Numeric() }) },
			({ body }) => body
		),
	requests: [
		{
			id: 'valid',
			make: () => {
				const fd = new FormData()
				fd.append('name', 'ada')
				fd.append('age', '36')
				return new Request(url('/form'), { method: 'POST', body: fd })
			}
		}
	]
})

corpus.push({
	id: 'urlencoded-body',
	tags: ['safe-for-socket', 'body', 'form'],
	define: (app) =>
		app.post(
			'/urlenc',
			{ body: t.Object({ name: t.String(), age: t.Numeric() }) },
			({ body }) => body
		),
	requests: [
		{
			id: 'valid',
			make: () =>
				new Request(url('/urlenc'), {
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded'
					},
					body: 'name=grace&age=85'
				})
		}
	]
})

corpus.push({
	id: 'headers',
	tags: ['safe-for-socket', 'headers', 'schema'],
	define: (app) =>
		app.get(
			'/h',
			{ headers: t.Object({ 'x-token': t.String() }) },
			({ headers }) => `token=${headers['x-token']}`
		),
	requests: [
		{
			id: 'valid',
			make: () =>
				new Request(url('/h'), { headers: { 'x-token': 'secret' } })
		},
		{
			// A socket adds its port to the host echoed by the 422 response.
			id: 'missing-422',
			make: get('/h'),
			tags: ['handle-only']
		}
	]
})

corpus.push({
	id: 'cookies',
	tags: ['safe-for-socket', 'cookies'],
	define: (app) =>
		app
			.get(
				'/cookie/read',
				({ cookie }: any) => `v=${cookie.session?.value ?? 'none'}`
			)
			.get('/cookie/write-one', ({ cookie }: any) => {
				cookie.session.value = 'abc'
				return 'set'
			})
			.get('/cookie/write-many', ({ cookie }: any) => {
				cookie.a.value = '1'
				cookie.b.value = '2'
				return 'set-many'
			})
			.get('/cookie/attrs', ({ cookie }: any) => {
				cookie.token.set({
					value: 'xyz',
					httpOnly: true,
					path: '/api',
					maxAge: 3600
				})
				return 'set-attrs'
			}),
	requests: [
		{
			id: 'read',
			make: () =>
				new Request(url('/cookie/read'), {
					headers: { cookie: 'session=hello' }
				})
		},
		{ id: 'write-one', make: get('/cookie/write-one') },
		{ id: 'write-many', make: get('/cookie/write-many') },
		{ id: 'write-attrs', make: get('/cookie/attrs') }
	]
})

corpus.push({
	id: 'response-schema',
	tags: ['safe-for-socket', 'schema', 'response'],
	define: (app) => {
		const Coded = t
			.Codec(t.String())
			.Decode((s: string) => Number(s.replace(/^n:/, '')))
			.Encode((n: number) => `n:${n}`)
		return app
			.get(
				'/resp',
				{ response: t.Object({ v: t.Number(), ok: t.Boolean() }) },
				() => ({ v: 42, ok: true })
			)
			.get('/resp-codec', { response: t.Object({ v: Coded }) }, () => ({
				v: 7
			}))
	},
	requests: [
		{ id: 'plain', make: get('/resp') },
		{ id: 'codec-encode', make: get('/resp-codec') }
	]
})

corpus.push({
	id: 'errors',
	tags: ['safe-for-socket', 'error', 'redirect'],
	define: (app) =>
		app
			.get('/throw', () => {
				throw new Error('boom')
			})
			.get('/status-return', () => status(418, 'teapot'))
			.get('/status-throw', () => {
				throw status(418, 'teapot')
			})
			.get('/redirect', () => redirect('http://localhost/dest', 302))
			.get('/r308', () => redirect('/target', 308))
			.get('/rset', ({ set }: any) => {
				set.redirect = '/target2'
			})
			.get('/dest', () => 'arrived'),
	requests: [
		{ id: 'not-found', make: get('/does-not-exist') },
		{ id: 'thrown-error', make: get('/throw') },
		{ id: 'status-return', make: get('/status-return') },
		{ id: 'status-throw', make: get('/status-throw') },
		{ id: 'redirect', make: get('/redirect') },
		{ id: '308', make: get('/r308') },
		{ id: 'set-redirect', make: get('/rset') }
	]
})

class TeapotError extends Error {
	code = 'TEAPOT'
	status = 418
	constructor() {
		super('i-am-a-teapot')
	}
}
corpus.push({
	id: 'custom-error',
	tags: ['safe-for-socket', 'error'],
	define: (app) =>
		(app as any)
			.error(TeapotError, ({ error, set }: any) => {
				set.status = 418
				return { handled: (error as TeapotError).code }
			})
			.get('/custom', () => {
				throw new TeapotError()
			}),
	requests: [{ id: 'thrown-custom', make: get('/custom') }]
})

corpus.push({
	id: 'empty-bodies',
	tags: ['safe-for-socket', 'response'],
	define: (app) =>
		app
			.get('/empty-string', () => '')
			.get('/null', () => null)
			.get('/undefined', () => undefined)
			.get('/no-content', ({ set }: any) => {
				set.status = 204
				return null
			}),
	requests: [
		{ id: 'empty-string', make: get('/empty-string') },
		{ id: 'null', make: get('/null') },
		{ id: 'undefined', make: get('/undefined') },
		{ id: 'status-204', make: get('/no-content') }
	]
})

corpus.push({
	id: 'streams',
	tags: ['safe-for-socket', 'stream'],
	define: (app) =>
		app
			.get('/gen', async function* () {
				yield 'chunk-a'
				yield 'chunk-b'
				yield 'chunk-c'
			})
			.get('/bytes', () => {
				const payload = new Uint8Array([0, 1, 2, 3, 255, 254, 253])
				return new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(payload.slice(0, 3))
						controller.enqueue(payload.slice(3))
						controller.close()
					}
				})
			}),
	requests: [
		{ id: 'generator', make: get('/gen') },
		{ id: 'raw-bytes', make: get('/bytes') }
	]
})

corpus.push({
	id: 'lifecycle',
	tags: ['safe-for-socket', 'lifecycle'],
	define: (app) =>
		app
			.request(({ request }: any) => {
				if (new URL(request.url).pathname === '/req-gate')
					return 'REQ-GATED'
			})
			.derive(() => ({ derived: 'D-value' }))
			.get(
				'/before',
				{ beforeHandle: () => 'BEFORE-WINS' },
				() => 'handler-body'
			)
			.get('/derived', ({ derived }: any) => `d=${derived}`)
			.get('/req-gate', () => 'handler-should-not-run'),
	requests: [
		{ id: 'before-short-circuit', make: get('/before') },
		{ id: 'request-hook-early-return', make: get('/req-gate') },
		{ id: 'derive-visible', make: get('/derived') }
	]
})

corpus.push({
	id: 'plugins-nested',
	tags: ['safe-for-socket', 'plugin', 'lifecycle'],
	define: (app) => {
		const inner = new Elysia()
			.guard({
				beforeHandle: ({ set }: any) => {
					set.headers['x-inner-guard'] = 'fired'
				}
			})
			.get('/inner', () => 'inner-body')
		const middle = new Elysia()
			.use(inner)
			.get('/middle', () => 'middle-body')
		return app
			.use(middle)
			.group('/grp', (g) =>
				g
					.guard({
						beforeHandle: ({ set }: any) => {
							set.headers['x-grp-guard'] = 'fired'
						}
					})
					.get('/leaf', () => 'grp-leaf')
			)
			.get('/top', () => 'top-body')
	},
	requests: [
		{ id: 'top', make: get('/top') },
		{ id: 'via-middle', make: get('/middle') },
		{ id: 'via-inner-plugin', make: get('/inner') },
		{ id: 'group-leaf', make: get('/grp/leaf') }
	]
})

corpus.push({
	id: 'scoped-ordering',
	tags: ['safe-for-socket', 'plugin', 'lifecycle'],
	define: (app) => {
		const scoped = new Elysia().beforeHandle('plugin', ({ set }) => {
			set.headers['x-scoped'] = 'yes'
		})
		return app.use(scoped).get('/after-scoped', () => 'ok')
	},
	requests: [{ id: 'after-scoped', make: get('/after-scoped') }]
})

corpus.push({
	id: 'async-native-promise',
	tags: ['safe-for-socket', 'async'],
	define: (app) =>
		app
			.get('/promise', async () => 'promise-value')
			.get(
				'/bh-promise',
				{ beforeHandle: async () => 'bh-promise-wins' },
				() => 'handler'
			),
	requests: [
		{ id: 'handler-promise', make: get('/promise') },
		{ id: 'beforehandle-promise', make: get('/bh-promise') }
	]
})

// Custom thenables are serialized as plain objects rather than awaited.
corpus.push({
	id: 'async-thenable',
	tags: ['safe-for-socket', 'async', 'custom-thenable'],
	define: (app) =>
		app
			.get('/thenable', () => makeThenable('thenable-value') as any)
			.get(
				'/bh-thenable',
				{ beforeHandle: () => makeThenable('bh-thenable-wins') as any },
				() => 'handler'
			),
	requests: [
		{ id: 'handler-thenable', make: get('/thenable') },
		{ id: 'beforehandle-thenable', make: get('/bh-thenable') }
	]
})

// A throwing `then` getter follows the normal error path.
corpus.push({
	id: 'throwing-then-getter',
	tags: [
		'safe-for-socket',
		'async',
		'custom-thenable',
		'throwing-then-getter'
	],
	define: (app) =>
		app.get('/throwing-then', () => makeThrowingThenGetter() as any),
	requests: [{ id: 'handler-throwing-then', make: get('/throwing-then') }]
})

// A real socket cannot receive `http://a/` as its request URL.
corpus.push({
	id: 'short-host',
	tags: ['handle-only', 'path', 'short-host'],
	define: (app) => app.get('/', () => 'root'),
	requests: [{ id: 'short-host-root', make: () => new Request('http://a/') }]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'observed-lifecycle',
		tags: ['safe-for-socket', 'observe', 'lifecycle'],
		recorder,
		define: (app) =>
			app.get(
				'/observed',
				{
					transform() {
						recorder.events.push('transform')
					},
					beforeHandle() {
						recorder.events.push('beforeHandle')
					},
					afterHandle() {
						recorder.events.push('afterHandle')
					}
				},
				() => {
					recorder.events.push('handler')
					return 'observed-ok'
				}
			),
		requests: [{ id: 'ordered-hooks', make: get('/observed') }]
	})
}

corpus.push({
	id: 'async-validator',
	tags: ['safe-for-socket', 'body', 'schema', 'async'],
	define: (app) =>
		app.post(
			'/async-validate',
			{
				parse: async (c: any) => JSON.parse(await c.request.text()),
				body: t.Object({ x: t.String() })
			} as any,
			({ body }: any) => body
		),
	requests: [
		{ id: 'valid', make: json('/async-validate', { x: 'ok' }) },
		{ id: 'invalid-422', make: json('/async-validate', { x: 5 }) }
	]
})

corpus.push({
	id: 'beforehandle-promise-branches',
	tags: ['safe-for-socket', 'lifecycle', 'async'],
	define: (app) =>
		app
			.get(
				'/bh-continue',
				{ beforeHandle: () => Promise.resolve(undefined) } as any,
				() => 'handler-ran'
			)
			.get(
				'/bh-shortcircuit',
				{ beforeHandle: () => Promise.resolve('short-wins') } as any,
				() => 'handler-ran'
			),
	requests: [
		{ id: 'continue', make: get('/bh-continue') },
		{ id: 'short-circuit', make: get('/bh-shortcircuit') }
	]
})

corpus.push({
	id: 'async-throw-after-await',
	tags: ['safe-for-socket', 'error', 'async'],
	define: (app) =>
		app.get('/async-throw', async () => {
			await Promise.resolve()
			throw new Error('after-await-boom')
		}),
	requests: [{ id: 'throws', make: get('/async-throw') }]
})

corpus.push({
	id: 'signed-cookie',
	tags: ['safe-for-socket', 'cookies'],
	define: (app) =>
		app.get(
			'/signed',
			{
				cookie: t.Cookie(
					{ session: t.Optional(t.String()) },
					{ secrets: 'sekret', sign: ['session'] }
				)
			},
			({ cookie }: any) => {
				cookie.session.value = 'signed-value'
				return 'signed'
			}
		),
	requests: [{ id: 'write-signed', make: get('/signed') }]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'observed-after-response',
		tags: ['safe-for-socket', 'observe', 'lifecycle'],
		recorder,
		define: (app) =>
			app.get(
				'/observed-ar',
				{
					afterResponse() {
						recorder.events.push('afterResponse')
					}
				},
				() => {
					recorder.events.push('handler')
					return 'ar-ok'
				}
			),
		requests: [{ id: 'exactly-once', make: get('/observed-ar') }]
	})
}

corpus.push({
	id: 'auto-head',
	tags: ['safe-for-socket', 'method', 'head'],
	define: (app) => app.use(autoHead()).get('/h', () => ({ a: 1 })) as any,
	requests: [
		{
			id: 'head',
			make: () => new Request(url('/h'), { method: 'HEAD' })
		},
		{ id: 'get', make: get('/h') }
	]
})

corpus.push({
	id: 'head-without-plugin',
	tags: ['safe-for-socket', 'method', 'head'],
	define: (app) => app.get('/head-plain', () => 'x'),
	requests: [
		{
			id: 'head',
			make: () => new Request(url('/head-plain'), { method: 'HEAD' })
		}
	]
})

corpus.push({
	id: 'method-not-allowed',
	tags: ['safe-for-socket', 'method'],
	define: (app) => app.get('/only-get', () => 'x'),
	requests: [
		{
			id: 'post',
			make: () => new Request(url('/only-get'), { method: 'POST' })
		},
		{
			id: 'options',
			make: () => new Request(url('/only-get'), { method: 'OPTIONS' })
		}
	]
})

corpus.push({
	id: 'sse-stream',
	tags: ['safe-for-socket', 'stream', 'sse'],
	define: (app) =>
		app.get('/sse', async function* () {
			yield sse({ data: 'one', event: 'e' })
			yield sse({ data: 'two', id: '2' })
		}),
	requests: [{ id: 'stream', make: get('/sse') }]
})

corpus.push({
	id: 'generator-throws-midstream',
	tags: ['safe-for-socket', 'stream', 'error'],
	define: (app) =>
		app.get('/g', async function* () {
			yield 'a'
			throw new Error('midstream')
		}),
	requests: [{ id: 'g', make: get('/g') }]
})

corpus.push({
	id: 'map-response',
	tags: ['safe-for-socket', 'lifecycle'],
	define: (app) =>
		app
			.mapResponse(({ response, set }: any) => {
				set.headers['x-mapped'] = '1'
				return new Response(`mapped:${response}`)
			})
			.get('/m', () => 'orig'),
	requests: [{ id: 'm', make: get('/m') }]
})

corpus.push({
	id: 'response-passthrough-with-set-headers',
	tags: ['safe-for-socket', 'response', 'headers'],
	define: (app) =>
		app.get('/p', ({ set }: any) => {
			set.headers['x-hook'] = 'h'
			set.status = 201
			return new Response('body', {
				status: 202,
				headers: { 'x-own': 'o', 'content-type': 'text/x-custom' }
			})
		}),
	requests: [{ id: 'p', make: get('/p') }]
})

corpus.push({
	id: 'cookie-remove',
	tags: ['safe-for-socket', 'cookies'],
	define: (app) =>
		app
			.get('/set', ({ cookie }: any) => {
				cookie.a.value = 'v'
				return 'ok'
			})
			.get('/rm', ({ cookie }: any) => {
				cookie.a.remove()
				return 'ok'
			}),
	requests: [
		{ id: 'set', make: get('/set') },
		{
			id: 'remove',
			make: () =>
				new Request(url('/rm'), { headers: { cookie: 'a=v' } })
		}
	]
})

corpus.push({
	id: 'derive-throws',
	tags: ['safe-for-socket', 'lifecycle', 'error'],
	define: (app) =>
		app
			.derive(() => {
				throw new Error('derive-boom')
			})
			.get('/d', () => 'x'),
	requests: [{ id: 'd', make: get('/d') }]
})

corpus.push({
	id: 'throw-nonerror',
	tags: ['safe-for-socket', 'error'],
	define: (app) =>
		app
			.get('/s', () => {
				throw 'a-string'
			})
			.get('/o', () => {
				throw { k: 'v' }
			})
			.get('/n', () => {
				throw null
			})
			.get('/u', () => {
				throw undefined
			}),
	requests: [
		{ id: 'string', make: get('/s') },
		{ id: 'object', make: get('/o') },
		{ id: 'null', make: get('/n') },
		{ id: 'undefined', make: get('/u') }
	]
})

corpus.push({
	id: 'status-throw-with-headers',
	tags: ['safe-for-socket', 'error', 'headers'],
	define: (app) =>
		app.get('/t', ({ set }: any) => {
			set.headers['x-pre'] = '1'
			throw status(403, { why: 'no' })
		}),
	requests: [{ id: 't', make: get('/t') }]
})

corpus.push({
	id: 'guard-group',
	tags: ['safe-for-socket', 'plugin', 'schema'],
	define: (app) =>
		app.group('/g', (a: any) =>
			a
				.guard({ query: t.Object({ q: t.String() }) })
				.get('/x', ({ query }: any) => query.q)
		),
	requests: [
		{ id: 'ok', make: get('/g/x?q=1') },
		// A socket adds its port to the host echoed by the 422 response.
		{ id: '422', make: get('/g/x'), tags: ['handle-only'] }
	]
})

corpus.push({
	id: 'file-response',
	tags: ['safe-for-socket', 'response', 'file'],
	define: (app) => app.get('/f', () => file('./package.json')),
	requests: [{ id: 'f', make: get('/f') }]
})

corpus.push({
	id: 'mount',
	tags: ['safe-for-socket', 'plugin'],
	define: (app) =>
		app.mount(
			'/mnt',
			(req: Request) => new Response(`mounted:${new URL(req.url).pathname}`)
		),
	requests: [
		{ id: 'root', make: get('/mnt') },
		{ id: 'sub', make: get('/mnt/a/b') }
	]
})

corpus.push({
	id: 'normalize-strip',
	tags: ['safe-for-socket', 'schema', 'body'],
	define: (app) =>
		app.post(
			'/n',
			{ body: t.Object({ a: t.String() }) },
			({ body }: any) => body
		),
	requests: [
		{
			id: 'extra-key',
			make: () =>
				new Request(url('/n'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ a: 'x', extra: 'y' })
				})
		}
	]
})

corpus.push({
	id: 'response-schema-mismatch',
	tags: ['safe-for-socket', 'schema', 'response'],
	define: (app) =>
		app.get(
			'/rs',
			{ response: t.Object({ a: t.Number() }) },
			() => ({ a: 'not-a-number' }) as any
		),
	requests: [{ id: 'rs', make: get('/rs') }]
})

corpus.push({
	id: 'afterhandle-returns',
	tags: ['safe-for-socket', 'lifecycle'],
	define: (app) =>
		app
			.afterHandle(({ response }: any) =>
				typeof response === 'string' ? response + '!' : undefined
			)
			.get('/a2', () => 'x')
			.get('/b2', () => ({ o: 1 })),
	requests: [
		{ id: 'string', make: get('/a2') },
		{ id: 'object', make: get('/b2') }
	]
})

// These routes omit autoHead to compare each lane's native HEAD behavior.
corpus.push({
	id: 'head-shapes',
	tags: ['safe-for-socket', 'method', 'head'],
	define: (app) =>
		app
			.get('/head/static', 'static-literal')
			.get('/head/dynamic', () => 'dynamic-value')
			.get(
				'/head/schema',
				{ response: t.Object({ v: t.Number() }) },
				() => ({ v: 1 })
			)
			.get('/head/empty', ({ set }: any) => {
				set.status = 204
				return null
			}),
	requests: [
		{
			id: 'static',
			make: () => new Request(url('/head/static'), { method: 'HEAD' }),
			// The native static lane returns 200 while the JS lane returns 404.
			excludeLanePairs: ['native-static-off-vs-on@listen']
		},
		{
			id: 'dynamic',
			make: () => new Request(url('/head/dynamic'), { method: 'HEAD' })
		},
		{
			id: 'response-schema',
			make: () => new Request(url('/head/schema'), { method: 'HEAD' })
		},
		{
			id: 'empty-body',
			make: () => new Request(url('/head/empty'), { method: 'HEAD' })
		}
	]
})
