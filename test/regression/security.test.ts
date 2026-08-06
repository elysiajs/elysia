import { describe, it, expect } from 'bun:test'
import { Elysia, form, t } from '../../src'
import { Numeric } from '../../src/type/elysia/numeric'
import { Value } from 'typebox/value'

describe('t.Numeric regex is linear, not catastrophic', () => {
	it('rejects a 200 KB digit-prefix attack within 250 ms', () => {
		const schema = Numeric()
		const attack = '9'.repeat(200_000) + 'x'

		const start = performance.now()
		expect(Value.Check(schema, attack)).toBe(false)
		const elapsed = performance.now() - start

		// Linear scan is sub-millisecond; a catastrophic-backtracking regex on 200 KB
		// runs for seconds, so anything under 250 ms proves the pattern is still linear.
		expect(elapsed).toBeLessThan(250)
	})

	it('accepts decimal syntax and rejects unsupported numeric syntax', () => {
		const schema = Numeric()
		for (const ok of ['0', '123', '-1', '1.5', '.5', '12.', '+.5'])
			expect(Value.Check(schema, ok)).toBe(true)
		for (const bad of ['', 'abc', '1e3', '0x10', '1.2.3', '--1'])
			expect(Value.Check(schema, bad)).toBe(false)
	})
})

describe('a CRLF-poisoned header never escapes app.handle', () => {
	const crlf = 'foo\r\nx-injected: pwned'

	it('drops a reflected CRLF header without creating an injected header', async () => {
		const app = new Elysia().get('/reflect', ({ query, set }) => {
			set.headers['x-echo'] = query.v ?? ''
			return 'ok'
		})

		const res = await app.handle(
			new Request(
				'http://localhost/reflect?v=' + encodeURIComponent(crlf)
			)
		)

		expect(res.headers.has('x-injected')).toBe(false)
	})

	it('a throwing .error() hook degrades to 500 instead of rejecting', async () => {
		const app = new Elysia()
			.error(() => {
				throw new Error('hook throws')
			})
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.status).toBe(500)
	})
})

describe('response dispatch never reads a client-owned marker', () => {
	// A parsed JSON body owns real `constructor` and `~ely-form` properties,
	// so dispatching on either lets the client pick the mapper branch. Both
	// switch sites are covered: bare app -> mapCompactResponse, default
	// headers -> mapResponseWithSet
	const apps = [
		new Elysia().post('/echo', ({ body }) => body),
		new Elysia().headers({ 'x-app': '1' }).post('/echo', ({ body }) => body)
	]

	const forge = (payload: unknown) =>
		new Request('http://e.ly/echo', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		})

	it('treats a body-owned constructor.name as ordinary JSON data', async () => {
		for (const app of apps)
			for (const spoof of [
				'Response',
				'String',
				'Promise',
				'Function',
				'ElysiaForm'
			]) {
				const res = await app.handle(
					forge({ constructor: { name: spoof }, x: 1 })
				)

				expect(res.status).toBe(200)
				await expect(res.json()).resolves.toEqual({
					constructor: { name: spoof },
					x: 1
				})
			}
	})

	it('a forged ElysiaStatus cannot set the status, location or set-cookie', async () => {
		for (const app of apps) {
			const res = await app.handle(
				forge({
					constructor: { name: 'ElysiaStatus' },
					code: 302,
					headers: {
						location: 'https://evil.example',
						'set-cookie': 'session=attacker'
					},
					response: 'redirected'
				})
			)

			expect(res.status).toBe(200)
			expect(res.headers.get('location')).toBeNull()
			expect(res.headers.get('set-cookie')).toBeNull()
		}
	})

	it('a forged ElysiaFile cannot pick the response content-type', async () => {
		for (const app of apps) {
			// `value` must be an object — handleFile throws on a string, which
			// would make this assertion pass for the wrong reason
			const res = await app.handle(
				forge({
					constructor: { name: 'ElysiaFile' },
					path: 'a.html',
					value: ['<script>alert(1)</script>']
				})
			)

			expect(res.headers.get('content-type')).not.toContain('text/html')
		}
	})

	it('a forged Cookie is serialised as JSON, not emitted as a raw body', async () => {
		for (const app of apps) {
			const res = await app.handle(
				forge({
					constructor: { name: 'Cookie' },
					jar: 1,
					value: 'raw-body-here'
				})
			)

			expect(res.headers.get('content-type')).toContain(
				'application/json'
			)
			expect(await res.text()).not.toBe('raw-body-here')
		}
	})

	it('treats a body-owned `~ely-form` key as ordinary JSON data', async () => {
		for (const app of apps) {
			const res = await app.handle(forge({ '~ely-form': 1, a: 'b' }))

			expect(res.headers.get('content-type')).toContain(
				'application/json'
			)
			await expect(res.json()).resolves.toEqual({
				'~ely-form': 1,
				a: 'b'
			})
		}
	})

	// Form-ness is a prototype, so forging it means controlling
	// `Object.getPrototypeOf(response)`. JSON.parse cannot: `__proto__` in a
	// JSON document becomes an ordinary own data property, and an own
	// `constructor` does not change the prototype's constructor. The top-level
	// body is additionally null-prototype, so these pin the lanes that are not
	// — a nested value and a urlencoded field — where the echoed object really
	// does carry `Object.prototype`.
	it('cannot be talked into multipart by a forged form prototype', async () => {
		const payloads = [
			{ __proto__: { constructor: { name: 'ElysiaForm' } }, a: 'b' },
			{ constructor: { name: 'ElysiaForm' }, a: 'b' },
			{ '~ely-form': 1, a: 'b' }
		]

		for (const app of [
			new Elysia().post('/echo', ({ body }) => body),
			// nested echo: `body.nested` is a plain Object.prototype object,
			// not the null-prototype top-level body
			new Elysia().post('/echo', ({ body }: any) => body.nested)
		])
			for (const payload of payloads) {
				const res = await app.handle(
					forge({ ...payload, nested: payload })
				)

				expect(res.headers.get('content-type')).toContain(
					'application/json'
				)
				expect(res.headers.get('content-type')).not.toContain(
					'multipart'
				)
			}
	})

	// A multipart field whose value parses as JSON is promoted to a real object
	// by `tryParseJson`, and unlike the top-level body that promoted object
	// carries `Object.prototype` — so echoing it reaches the mapper's plain
	// `Object` branch with fully client-controlled content. Multipart is the
	// lane plan 003's "the body is null-prototype" argument does *not* cover.
	it('cannot forge a form through a promoted multipart field', async () => {
		const app = new Elysia().post('/echo', ({ body }: any) => body.nested)

		for (const forged of [
			{ '~ely-form': 1, a: 'b' },
			{ constructor: { name: 'ElysiaForm' }, a: 'b' }
		]) {
			const fd = new FormData()
			fd.append('nested', JSON.stringify(forged))

			const res = await app.handle(
				new Request('http://e.ly/echo', { method: 'POST', body: fd })
			)

			expect(res.headers.get('content-type')).toContain(
				'application/json'
			)
			expect(res.headers.get('content-type')).not.toContain('multipart')
		}
	})

	// Defence in depth for the lanes above: the urlencoded and multipart body
	// objects are built null-prototype, so they carry no constructor at all and
	// never reach the mapper's `Object` branch in the first place.
	it('builds urlencoded and multipart bodies without a prototype', async () => {
		const protos: unknown[] = []
		const app = new Elysia().post('/echo', ({ body }) => {
			protos.push(Object.getPrototypeOf(body))
			return 'ok'
		})

		const fd = new FormData()
		fd.append('~ely-form', '1')

		await app.handle(
			new Request('http://e.ly/echo', {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				body: '~ely-form=1&a=b'
			})
		)
		await app.handle(
			new Request('http://e.ly/echo', { method: 'POST', body: fd })
		)

		expect(protos).toEqual([null, null])
	})

	// `form(body)` is a normal thing to write, and a JSON body can own a real
	// `__proto__` key. Building the form with `Object.assign` would *assign*
	// that key and so invoke the inherited `__proto__` setter, handing the
	// request control of the result's prototype — and the prototype is exactly
	// what response dispatch reads. With `constructor.name` set to `ElysiaFile`
	// that turns `form(body)` into an attacker-chosen content-type.
	it('form() cannot have its prototype hijacked by a body-owned __proto__', async () => {
		const app = new Elysia().post('/echo', ({ body }: any) => form(body))

		// raw JSON text, not an object literal: `__proto__:` in a literal is
		// prototype-setting syntax, so it would never reach the wire as a key
		const res = await app.handle(
			new Request('http://e.ly/echo', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body:
					'{"__proto__":{"constructor":{"name":"ElysiaFile"}},' +
					'"path":"x.html","value":["<script>alert(1)</script>"]}'
			})
		)

		expect(res.headers.get('content-type')).toStartWith(
			'multipart/form-data'
		)
		expect(res.headers.get('content-type')).not.toContain('text/html')

		// the copy keeps the caller's data as data — `__proto__` is carried as
		// an ordinary own field, not swallowed by the setter
		const fields = [...(await res.formData()).keys()]
		expect(fields).toContain('__proto__')
		expect(fields).toContain('path')
	})

	it('still emits multipart for a real form()', async () => {
		for (const app of [
			new Elysia().get('/f', () => form({ a: 'b' })),
			new Elysia()
				.headers({ 'x-app': '1' })
				.get('/f', () => form({ a: 'b' }))
		]) {
			const res = await app.handle(new Request('http://e.ly/f'))

			expect(res.headers.get('content-type')).toContain(
				'multipart/form-data'
			)
			expect(await res.text()).toContain('name="a"')
		}
	})
})

describe('a client cannot choose the prototype of a validated object', () => {
	// Plan 003 stopped dispatch from reading an *own* `constructor`; this pins
	// the layer under it. A `t.Record` has no schema-declared keys, so
	// exact-mirror cleans it by assigning the value's own keys into a fresh
	// `{}`. Assignment is `[[Set]]`, so a literal `__proto__` key runs
	// `Object.prototype`'s inherited setter and the *request* decides
	// `Object.getPrototypeOf(output)` — which is precisely what `responseTag`
	// reads. Every payload below is raw JSON text, never an object literal:
	// `__proto__:` in a literal is prototype-setting syntax, so the key would
	// never reach the wire.
	const forge = (tag: string, rest: string) =>
		`{"__proto__":{"constructor":{"name":"${tag}"}},${rest}}`

	const record = { body: t.Record(t.String(), t.Any()) }

	const post = (app: Elysia<any, any, any, any, any, any>, body: string) =>
		app.handle('/e', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		})

	// Both mapper lanes are independent switch sites: a bare app reaches
	// mapCompactResponse, default headers reach mapResponseWithSet.
	const echoes = () =>
		[
			new Elysia().post('/e', record, ({ body }) => body),
			new Elysia()
				.headers({ 'x-app': '1' })
				.post('/e', record, ({ body }) => body)
		] as Elysia<any, any, any, any, any, any>[]

	it('leaves the handler an ordinary object rooted at Object.prototype', async () => {
		// The mapper is only the loudest consumer. Any `body.isAdmin` style
		// read in user code resolves through the prototype chain too, so the
		// invariant is about the object itself, not about the response.
		const seen: unknown[] = []
		const app = new Elysia().post('/e', record, ({ body }) => {
			seen.push(Object.getPrototypeOf(body))
			return 'ok'
		})

		await post(app, forge('ElysiaFile', '"path":"a.html"'))

		expect(seen).toEqual([Object.prototype])
	})

	it('a forged ElysiaFile prototype cannot pick the content-type', async () => {
		// `value` must be an object — handleFile throws on a string, which
		// would make this assertion pass for the wrong reason
		for (const app of echoes()) {
			const res = await post(
				app,
				forge(
					'ElysiaFile',
					'"path":"a.html","value":["<script>alert(1)</script>"]'
				)
			)

			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toContain(
				'application/json'
			)
			expect(res.headers.get('content-type')).not.toContain('text/html')
			await expect(res.text()).resolves.not.toBe(
				'<script>alert(1)</script>'
			)
		}
	})

	it('a forged ElysiaStatus prototype cannot set the status, location or set-cookie', async () => {
		for (const app of echoes()) {
			const res = await post(
				app,
				forge(
					'ElysiaStatus',
					'"code":302,"headers":{"location":"https://evil.example",' +
						'"set-cookie":"session=attacker"},"response":"x"'
				)
			)

			expect(res.status).toBe(200)
			expect(res.headers.get('location')).toBeNull()
			expect(res.headers.get('set-cookie')).toBeNull()
		}
	})

	it('a forged ElysiaForm prototype cannot switch the response to multipart', async () => {
		for (const app of echoes()) {
			const res = await post(app, forge('ElysiaForm', '"a":"b"'))

			expect(res.headers.get('content-type')).toContain(
				'application/json'
			)
			expect(res.headers.get('content-type')).not.toContain('multipart')
		}
	})

	it('a forged Cookie prototype cannot emit a raw attacker body', async () => {
		for (const app of echoes()) {
			const res = await post(
				app,
				forge('Cookie', '"jar":1,"value":"raw-body-here"')
			)

			expect(res.headers.get('content-type')).toContain(
				'application/json'
			)
			await expect(res.text()).resolves.not.toBe('raw-body-here')
		}
	})

	it('is closed on the multipart delivery lane', async () => {
		// A multipart field whose value parses as JSON is promoted to a real
		// object by `tryParseJson`, so multipart can carry the same `__proto__`
		// payload the JSON lane does — a different assembly path into the same
		// record cleaner.
		for (const app of echoes()) {
			const fd = new FormData()
			fd.append('__proto__', '{"constructor":{"name":"ElysiaFile"}}')
			fd.append('path', 'a.html')
			fd.append('value', '["<script>alert(1)</script>"]')

			const res = await app.handle('/e', { method: 'POST', body: fd })

			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toContain(
				'application/json'
			)
			expect(res.headers.get('content-type')).not.toContain('text/html')
		}
	})

	it('is closed for a nested t.Record and for a t.Record response schema', async () => {
		// A Record anywhere in the schema arms the same cleaner: nested under a
		// t.Object on the way in, or on the response slot on the way out.
		const nested = new Elysia().post(
			'/e',
			{ body: t.Object({ n: t.Record(t.String(), t.Any()) }) },
			({ body }) => body.n
		)
		const response = new Elysia().post(
			'/e',
			{ response: t.Record(t.String(), t.Any()) },
			({ body }) => body
		)
		const payload = forge(
			'ElysiaFile',
			'"path":"a.html","value":["<script>alert(1)</script>"]'
		)

		for (const [app, body] of [
			[nested, `{"n":${payload}}`],
			[response, payload]
		] as const) {
			const res = await post(
				app as Elysia<any, any, any, any, any, any>,
				body
			)

			expect(res.headers.get('content-type')).toContain(
				'application/json'
			)
			expect(res.headers.get('content-type')).not.toContain('text/html')
		}
	})

	it('round-trips a legitimate __proto__ data field', async () => {
		// The fix must not cost a user the ability to carry a field genuinely
		// named `__proto__`. It is data on the way in and data on the way out;
		// only the prototype-setting side effect is gone.
		const payload = '{"__proto__":{"a":1},"b":2}'

		for (const app of echoes()) {
			const res = await post(app, payload)

			expect(res.status).toBe(200)
			await expect(res.text()).resolves.toBe(payload)
		}
	})

	it('still validates and echoes an ordinary t.Record body', async () => {
		// Paired positive control: the security assertions above are also
		// satisfied by breaking t.Record outright.
		for (const app of echoes()) {
			await expect(
				post(app, '{"a":1,"b":"two"}').then((res) => res.json())
			).resolves.toEqual({ a: 1, b: 'two' })

			expect((await post(app, '"not-an-object"')).status).toBe(422)
		}
	})
})

describe('production 422 does not echo the request body', () => {
	it('redacts submitted values while retaining the invalid property path', async () => {
		const prev = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'
		try {
			const app = new Elysia().post(
				'/login',
				{ body: t.Object({ n: t.Number() }) },
				({ body }) => body
			)
			const res = await app.handle(
				new Request('http://e.ly/login', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ password: 'secret-pw', n: 'x' })
				})
			)
			const body: any = await res.json()
			expect(res.status).toBe(422)
			expect(body.property).toBe('/n')
			expect(body.found).toBeUndefined()
			expect(JSON.stringify(body)).not.toContain('secret-pw')
		} finally {
			process.env.NODE_ENV = prev
		}
	})
})

describe('macro seed dedup is collision-safe', () => {
	it('throws a clear error for a circular seed value', () => {
		const withMacro = new Elysia().macro({
			auth: () => ({ beforeHandle() {} })
		})
		const circular: any = {}
		circular.self = circular

		expect(() =>
			new Elysia()
				.use(withMacro)
				.get('/', { auth: circular } as any, () => 'x')
				['fetch'].toString()
		).toThrow(/circular seed/)
	})

	it('runs hooks for distinct function-valued seeds', async () => {
		// JSON.stringify drops both functions, so identity must distinguish them.
		const ran: string[] = []
		const app = new Elysia()
			.macro({
				check: (v: any) => ({
					beforeHandle() {
						v.fn()
					}
				}),
				wrapper: () => ({ check: { fn: () => ran.push('A') } })
			})
			.get(
				'/x',
				{ wrapper: true, check: { fn: () => ran.push('B') } } as any,
				() => 'ok'
			)

		await app.handle(new Request('http://e.ly/x'))
		expect(ran.sort()).toEqual(['A', 'B'])
	})

	it('deduplicates an identical seed so its hook runs once', async () => {
		let count = 0
		const app = new Elysia()
			.macro({
				check: () => ({
					beforeHandle() {
						count++
					}
				}),
				wrapper: () => ({ check: { role: 'admin' } })
			})
			.get(
				'/x',
				{ wrapper: true, check: { role: 'admin' } } as any,
				() => 'ok'
			)

		await app.handle(new Request('http://e.ly/x'))
		expect(count).toBe(1)
	})
})

describe('cookie name/attributes reject injection chars', () => {
	it('rejects separators while allowing a valid cookie', async () => {
		const { serialize } = await import('../../src/cookie/lib')
		expect(() => serialize('a;b', 'v', {})).toThrow(/Invalid cookie name/)
		expect(() => serialize('ok', 'v', { path: '/a; Secure' })).toThrow(
			/Invalid cookie Path/
		)
		expect(serialize('sid', 'abc', { path: '/' })).toContain('sid=abc')
	})
})

describe('the last-resort 500 never throws', () => {
	it('handles circular causes and throwing message getters', async () => {
		const { internalServerErrorResponse } = await import('../../src/error')

		const circular: any = new Error('boom')
		circular.cause = {}
		circular.cause.self = circular.cause

		const throwingGetter: any = new Error()
		Object.defineProperty(throwingGetter, 'message', {
			get() {
				throw new Error('getter boom')
			}
		})

		for (const e of [circular, throwingGetter]) {
			const res = internalServerErrorResponse(e)
			expect(res.status).toBe(500)
		}
	})
})
