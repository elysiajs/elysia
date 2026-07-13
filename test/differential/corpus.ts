/**
 * D2 differential harness — route + request corpus.
 *
 * See design/n-proof.md (D2) and README.md. Each entry describes ONE app
 * (`define`) plus a set of requests to fire against it. Every lane in the matrix
 * builds a FRESH app from `define` and runs each request against it; `compare.ts`
 * asserts the lanes agree byte-for-byte.
 *
 * ── Elysia API gotchas encoded here ────────────────────────────────────────
 * • Verb signature is `(path, hook, handler)` OR `(path, handler)`. Passing the
 *   HANDLER first with a schema object second silently registers the schema as a
 *   STATIC RESPONSE (not a bug — it is the 2-arg form with a plain-object body).
 *   Every schema-bearing route below therefore uses `(path, { ...schema }, fn)`.
 * • There is no `.route(method, ...)` custom-method API in this codebase — only
 *   the standard verbs and `.all()`. Custom HTTP methods are exercised through
 *   `.all()` (see README "known-gaps").
 * • Request URLs use `http://localhost/...` except the deliberate short-host case.
 *
 * Tags drive matrix subsetting (see differential.test.ts):
 *   'handle-only'      — do not run under the real-socket (listen) lanes.
 *   'safe-for-socket'  — explicitly safe for listen lanes (default for most).
 *   'known-divergence' — lanes disagree TODAY; skipped via test.todo naming the fix.
 *   'observe'          — carries a per-request observation recorder (P0-9).
 */

import { Elysia, t, status, redirect, type AnyElysia } from '../../src'

export interface CorpusRequest {
	id: string
	make: () => Request
	tags?: string[]
}

export interface CorpusEntry {
	id: string
	tags: string[]
	/**
	 * Build the app under test. Called fresh per (lane, entry). Typed as
	 * `AnyElysia` (= `Elysia<any…>`): a chained `.get()` returns a branded
	 * `AddRoute<…>` subtype that a bare `Elysia<'',…>` annotation rejects, so the
	 * corpus uses the widened alias the rest of the codebase uses for this shape.
	 */
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

/**
 * A per-request observation recorder. `define` closes over ONE recorder; each
 * request resets it, runs, then the lane's `observe()` returns its contents.
 * This is the shape A2's "hook fires on a promoted route" gate will assert.
 */
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

/**
 * Some entries need a recorder shared between `define` and the lane's observe().
 * We attach it to the entry so lanes.ts can wire `observe()` to it. Only entries
 * tagged 'observe' set this.
 */
export interface ObservableCorpusEntry extends CorpusEntry {
	recorder?: Recorder
}

// A custom thenable — NOT a native Promise. Elysia's current dispatch checks
// `instanceof Promise`, so this object is treated as a plain value and serialized
// as `{}`. That is the KNOWN thenable-bypass bug fixed by task A5. All lanes
// reproduce it identically today, so it is pinned (not skipped) — see README.
const makeThenable = (value: unknown) => ({
	then(resolve: (v: unknown) => void) {
		resolve(value)
	}
})

// An object whose `then` is a GETTER that THROWS when read (P1-4, B2's `maybe`
// edge). Any thenable-detection that reads `.then` to classify the value will
// blow up here; a detector that checks `instanceof Promise` first will not. This
// probes the maybe-classification boundary (A5/B2). Whatever the lanes do today,
// they must AGREE — if they diverge, retag 'known-divergence' + test.todo (below).
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

// ── A2 native-static promotion correctness ────────────────────────────────
corpus.push({
	id: 'native-static-literal',
	tags: ['safe-for-socket', 'static', 'native-static-A2'],
	define: (app) => app.get('/native/literal', 'literal'),
	requests: [{ id: 'literal', make: get('/native/literal') }]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'native-static-after-response',
		tags: ['safe-for-socket', 'static', 'observe', 'native-static-A2'],
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

corpus.push({
	id: 'native-static-all',
	tags: ['safe-for-socket', 'static', 'method', 'native-static-A2'],
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
	tags: ['safe-for-socket', 'static', 'lifecycle', 'native-static-A2'],
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

// ── Static / nesting / root ────────────────────────────────────────────────
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

// ── Params ─────────────────────────────────────────────────────────────────
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

// ── Encoded + unicode param values ─────────────────────────────────────────
corpus.push({
	id: 'param-encoding',
	tags: ['safe-for-socket', 'param', 'unicode'],
	define: (app) => app.get('/echo/:v', ({ params }: any) => params.v),
	requests: [
		// Thai
		{
			id: 'thai',
			make: get(
				'/echo/%E0%B8%AA%E0%B8%A7%E0%B8%B1%E0%B8%AA%E0%B8%94%E0%B8%B5'
			)
		},
		// emoji
		{ id: 'emoji', make: get('/echo/%F0%9F%9A%80') },
		// percent-encoded reserved chars (slash-encoded stays in the segment)
		{ id: 'reserved', make: get('/echo/a%2Fb%20c') }
	]
})

// ── Wildcard ───────────────────────────────────────────────────────────────
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

// ── Non-tail optional param (supported: `/a/:b?/c`) ─────────────────────────
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

// ── Trailing-slash / loose-path (strictPath default = false) ────────────────
corpus.push({
	id: 'trailing-slash',
	tags: ['safe-for-socket', 'path'],
	define: (app) => app.get('/loose', () => 'loose'),
	requests: [
		{ id: 'no-slash', make: get('/loose') },
		{ id: 'trailing-slash', make: get('/loose/') }
	]
})

// ── Literal shadows param (precedence) ─────────────────────────────────────
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

// ── Duplicate (method, path) registration: last-wins uniformly ──────────────
// No dedup enforcement — duplicate registration is the user's responsibility.
// The LAST registration wins across every lane and route type: the static map
// and AOT manifest overwrite, and Memoirist >= 1.2.0 overwrites its terminal
// store on a repeat add. Both static and dynamic duplicates are pinned so a
// future lane-parity break (e.g. AOT diverging from the router) is caught.
corpus.push({
	id: 'duplicate-route-static',
	tags: ['safe-for-socket', 'precedence'],
	define: (app) =>
		app.get('/dup', () => 'first').get('/dup', () => 'second'),
	requests: [{ id: 'static-last-wins', make: get('/dup') }]
})

corpus.push({
	id: 'duplicate-route-dynamic',
	tags: ['safe-for-socket', 'precedence'],
	define: (app) =>
		app
			.get('/dup/:id', () => 'first')
			.get('/dup/:id', () => 'second'),
	requests: [{ id: 'dynamic-last-wins', make: get('/dup/1') }]
})

// ── Custom method via .all() (no .route() API exists — see README) ──────────
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

// ── Query coercion (scalar) ────────────────────────────────────────────────
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

// ── Query with object-in-query + extra keys ────────────────────────────────
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

// ── JSON body validation ───────────────────────────────────────────────────
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
			// own-'__proto__' key in the body — pollution-safe mirror (A16) territory.
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

// ── Multipart form (fields only, no File) ──────────────────────────────────
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

// ── URL-encoded body ───────────────────────────────────────────────────────
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

// ── Header schema + single header read ─────────────────────────────────────
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
			// handle-only: the 422 body echoes the request `host` header, which on
			// a real socket includes the ephemeral listen port. Two lanes bind two
			// ports, so their echoed bodies differ ONLY by the port number — a
			// harness artifact, not a lane divergence (verified identical after
			// port-normalization). Under app.handle() both lanes share the fixed
			// `http://localhost` host, so no skew. See README "known-gaps".
			id: 'missing-422',
			make: get('/h'),
			tags: ['handle-only']
		}
	]
})

// ── Cookies: read / write one / write multiple / attributes ────────────────
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
				// Ordered set-cookie: a then b. Order is compared strictly.
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

// ── Response schema + encode/codec path ────────────────────────────────────
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

// ── Errors: 404 / 422 / thrown Error / custom error / status() / redirect ───
corpus.push({
	id: 'errors',
	tags: ['safe-for-socket', 'error'],
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
			.get('/dest', () => 'arrived'),
	requests: [
		{ id: 'not-found', make: get('/does-not-exist') },
		{ id: 'thrown-error', make: get('/throw') },
		{ id: 'status-return', make: get('/status-return') },
		{ id: 'status-throw', make: get('/status-throw') },
		{ id: 'redirect', make: get('/redirect') }
	]
})

// ── Custom error class via .error() + throw ────────────────────────────────
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
			// `.error(Class, fn)` both registers the error class and handles it.
			.error(TeapotError, ({ error, set }: any) => {
				set.status = 418
				return { handled: (error as TeapotError).code }
			})
			.get('/custom', () => {
				throw new TeapotError()
			}),
	requests: [{ id: 'thrown-custom', make: get('/custom') }]
})

// ── Empty-body / 204 responses ─────────────────────────────────────────────
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

// ── Streams: async generator (SSE-ish) + raw byte ReadableStream ───────────
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

// ── Lifecycle: beforeHandle short-circuit + onRequest early return + derive ─
corpus.push({
	id: 'lifecycle',
	tags: ['safe-for-socket', 'lifecycle'],
	define: (app) =>
		app
			// `.request()` is the request-level early-return hook (no `.onRequest`).
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
		{ id: 'onrequest-early-return', make: get('/req-gate') },
		{ id: 'derive-visible', make: get('/derived') }
	]
})

// ── group/guard with hooks + nested .use chains (plugin in plugin) ──────────
corpus.push({
	id: 'plugins-nested',
	tags: ['safe-for-socket', 'plugin', 'lifecycle'],
	define: (app) => {
		// OBSERVABLE guard hooks (P1-4): each guard's beforeHandle stamps a header
		// so its firing (and the fact it does NOT bleed onto sibling routes) is
		// detectable across lanes. A no-op `() => undefined` proves nothing.
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

// ── Scoped plugin ordering (P1-4) ──────────────────────────────────────────
corpus.push({
	id: 'scoped-ordering',
	tags: ['safe-for-socket', 'plugin', 'lifecycle'],
	define: (app) => {
		// A scoped plugin's hooks propagate to the parent's routes registered
		// AFTER `.use`. Order must be deterministic across lanes.
		const scoped = new Elysia().beforeHandle('plugin', ({ set }) => {
			set.headers['x-scoped'] = 'yes'
		})
		return app.use(scoped).get('/after-scoped', () => 'ok')
	},
	requests: [{ id: 'after-scoped', make: get('/after-scoped') }]
})

// ── Async classification (P1-4, feeds B2) ──────────────────────────────────
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

// KNOWN-DIVERGENCE candidate: custom thenables. Empirically (probed 2026-07-12)
// ALL v1 lanes reproduce the broken `{}` serialization identically, so lanes
// AGREE and this is pinned rather than skipped. If a future src change makes any
// lane diverge, retag 'known-divergence' + convert to test.todo naming A5.
corpus.push({
	id: 'async-thenable',
	tags: ['safe-for-socket', 'async', 'thenable-bypass-A5'],
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

// ── Throwing-`then`-getter (P1-4, B2 `maybe` edge) ─────────────────────────
// A handler returning an object whose `.then` getter throws. Probes the
// maybe-classification boundary (A5/B2). All v1 lanes must AGREE on the outcome;
// if a future src change makes any lane diverge, retag 'known-divergence' and
// convert to test.todo naming B2/A5. (Verdict at authoring: see README.)
corpus.push({
	id: 'throwing-then-getter',
	tags: ['safe-for-socket', 'async', 'thenable-bypass-A5', 'maybe-B2'],
	define: (app) =>
		app.get('/throwing-then', () => makeThrowingThenGetter() as any),
	requests: [{ id: 'handler-throwing-then', make: get('/throwing-then') }]
})

// ── Short-host request (A7) — lanes must agree (both 404 today) ────────────
// handle-only: a real socket cannot receive `http://a/` as the request URL; the
// short-host path-extraction bug only manifests through app.handle().
corpus.push({
	id: 'short-host',
	tags: ['handle-only', 'path', 'short-host-A7'],
	define: (app) => app.get('/', () => 'root'),
	requests: [{ id: 'short-host-root', make: () => new Request('http://a/') }]
})

// ── Observation entry (P0-9): hooks push ordered event names ────────────────
// The recorder is shared with the lane via `entry.recorder`; lanes.ts resets it
// per request and returns its contents from `observe()`.
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

// ── B2 part-2 additions ─────────────────────────────────────────────────────

// Async request validator (a custom async parser then a body schema): the resume
// lane transfers through `__resume`; the other lane pairs exercise their own
// async-validation paths. Covers the 200 (valid) and 422 (invalid) branches.
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

// beforeHandle returning a NATIVE Promise: resolving `undefined` continues to the
// handler; resolving a value short-circuits. The resume lane handles both
// branches natively, and the behavior is pinned across every lane pair.
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

// Async handler that throws AFTER an await: the rejection must surface as the
// framework 500 identically across lanes (and, for the resume lane, prove the
// continuation rejection path is not swallowed).
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

// Signed-cookie route: HMAC signing forces the async cookie-sign path (or the
// sync-HMAC path where available) → resume falls back, but the set-cookie
// signature bytes are pinned across lanes. The secret is fixed so the signature
// is deterministic.
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

// afterResponse observation (P0-9): the hook must fire EXACTLY ONCE and AFTER the
// response is produced. Genuinely covered by the resume lane (sync afterResponse
// `_fin`/`_fin2` tee path) — native coverage, not trivial fallback equality.
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
