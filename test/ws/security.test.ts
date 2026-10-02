import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsMessage, wsClosed, wsClose } from './utils'

/**
 * Every case here is a control that HTTP already enforces and WebSocket did
 * not. The point of each test is the *parity*: the same declaration must mean
 * the same thing on both transports, otherwise a developer hardens one and
 * silently ships the other open.
 */

const upgradeHeaders = (cookie?: string) => ({
	upgrade: 'websocket',
	connection: 'Upgrade',
	'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
	'sec-websocket-version': '13',
	...(cookie ? { cookie } : {})
})

/** Status of a real (non-simulated) upgrade attempt against a live server. */
const upgradeStatus = async (
	server: { hostname: string; port: number },
	path: string,
	cookie?: string
) =>
	(
		await fetch(`http://${server.hostname}:${server.port}${path}`, {
			headers: upgradeHeaders(cookie)
		})
	).status

describe('WebSocket response schema redaction', () => {
	// A `response` schema is the idiomatic way to strip internal fields before
	// they leave the process. HTTP honours that (the JIT response lane cleans);
	// WS used to `Check` only, so the identical schema redacted on one
	// transport and leaked on the other.
	it('strips undeclared fields exactly as the HTTP response lane does', async () => {
		const User = t.Object({ id: t.String() })
		const leaky = {
			id: 'u1',
			passwordHash: 'SECRET-HASH',
			email: 'a@b.c'
		}

		const app = new Elysia()
			.use(websocket())
			.get('/u', { response: User }, () => leaky)
			.ws('/u', {
				response: User,
				message(ws: any) {
					ws.send(leaky)
				}
			})
			.listen(0)

		const http = await (await app.handle('/u')).text()

		const ws = newWebsocket(app.server!, '/u')
		await wsOpen(ws)
		const frame = wsMessage(ws)
		ws.send('go')
		const wsBody = String((await frame).data)

		await wsClosed(ws)
		app.stop()

		expect(http).toBe('{"id":"u1"}')
		expect(wsBody).toBe(http)
		expect(wsBody).not.toContain('SECRET-HASH')
	})

	// Redaction must not turn into encoding: WS deliberately sends raw values,
	// pinned by test/parity/http-vs-ws.test.ts. Keep both halves in one place
	// so a future "just use EncodeFrom" does not silently flip the contract.
	it('still refuses a codec response instead of encoding it', async () => {
		const Coded = t
			.Codec(t.String())
			.Decode((s: string) => Number(s.replace(/^n:/, '')))
			.Encode((n: number) => `n:${n}`)

		const app = new Elysia()
			.use(websocket())
			.ws('/c', {
				response: t.Object({ v: Coded }),
				message(ws: any) {
					ws.send({ v: 42 })
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/c')
		await wsOpen(ws)
		const frame = wsMessage(ws)
		ws.send('go')
		const body = String((await frame).data)

		await wsClosed(ws)
		app.stop()

		expect(body).not.toBe('{"v":"n:42"}')
		expect(body).toContain('must be string')
	})
})

describe('WebSocket upgrade cookie validation', () => {
	// `.ws()` accepts a `cookie` schema and the WS route type claims it is
	// enforced. Ignoring it meant a signed-session route upgraded a peer that
	// presented no cookie at all, and `ws.cookie` was `undefined` so the
	// handler could not check for itself.
	it('rejects an upgrade that is missing a required cookie', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ck', {
				cookie: t.Cookie({ token: t.String() }),
				message(ws: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const missing = await upgradeStatus(app.server!, '/ck')
		const present = await upgradeStatus(app.server!, '/ck', 'token=abc')

		app.stop()

		expect(missing).toBe(422)
		expect(present).toBe(101)
	})

	// A forged signature is the case that actually authenticates someone: the
	// jar must never hand the handler a value that failed verification.
	it('rejects an upgrade presenting a forged signed cookie', async () => {
		const app = new Elysia({
			cookie: { secrets: 'secret', sign: ['session'] }
		})
			.use(websocket())
			.ws('/s', {
				cookie: t.Cookie({ session: t.String() }),
				message(ws: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const forged = await upgradeStatus(app.server!, '/s', 'session=forged')

		app.stop()

		expect(forged).toBe(400)
	})

	// The jar itself must reach the handler, otherwise an app reading
	// `ws.cookie.token.value` gets a TypeError instead of an auth decision.
	it('exposes the parsed cookie jar on the socket', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ck', {
				cookie: t.Cookie({ token: t.String() }),
				message(ws: any) {
					ws.send(ws.cookie.token.value)
				}
			})
			.listen(0)

		const server = app.server!
		const ws = new WebSocket(`ws://${server.hostname}:${server.port}/ck`, {
			headers: { cookie: 'token=abc' }
		} as any)
		await wsOpen(ws)
		const frame = wsMessage(ws)
		ws.send('go')
		const body = String((await frame).data)

		await wsClosed(ws)
		app.stop()

		expect(body).toBe('abc')
	})

	// A route that never declared a cookie schema must not start paying for,
	// or failing on, cookie verification.
	it('leaves routes without a cookie schema untouched', async () => {
		const app = new Elysia({
			cookie: { secrets: 'secret', sign: ['session'] }
		})
			.use(websocket())
			.ws('/plain', {
				message(ws: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const status = await upgradeStatus(
			app.server!,
			'/plain',
			'session=forged'
		)

		app.stop()

		expect(status).toBe(101)
	})
})

describe('WebSocket foreign error disclosure', () => {
	afterEach(() => {
		delete process.env.NODE_ENV
	})

	// `.response` is the framework's "declared body" opt-out of the production
	// mask, but the property name is owned by the popular HTTP clients too —
	// an AxiosError parks the whole upstream response (auth headers included)
	// there. Rethrowing one must not publish it.
	it('does not serve a foreign 5xx .response object in production', async () => {
		process.env.NODE_ENV = 'production'

		const app = new Elysia()
			.use(websocket())
			.ws('/e', {
				message() {
					throw Object.assign(new Error('boom'), {
						status: 502,
						response: {
							config: {
								headers: { authorization: 'Bearer SECRET' }
							}
						}
					})
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/e')
		await wsOpen(ws)
		const frame = wsMessage(ws)
		ws.send('go')
		const body = String((await frame).data)

		await wsClosed(ws)
		app.stop()

		expect(body).not.toContain('Bearer SECRET')
		expect(body).toBe('Internal Server Error')
	})

	// A developer-authored string body is the pinned opt-out and must survive.
	it('keeps an authored string .response in production', async () => {
		process.env.NODE_ENV = 'production'

		const app = new Elysia()
			.use(websocket())
			.ws('/e', {
				message() {
					throw Object.assign(new Error('boom'), {
						status: 500,
						response: 'explicit body'
					})
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/e')
		await wsOpen(ws)
		const frame = wsMessage(ws)
		ws.send('go')
		const body = String((await frame).data)

		await wsClosed(ws)
		app.stop()

		expect(body).toBe('explicit body')
	})
})

describe('WebSocket derive prototype integrity', () => {
	// `Object.assign` *assigns*, so an own `__proto__` on a derive result that
	// carries parsed input reaches the inherited setter and reparents the live
	// context: injected properties read through as if the derive had returned
	// them, and the real members (`status`, `redirect`, ...) disappear. Same
	// hazard the `form()` helper already guards against.
	//
	// Both merge lanes are covered because they take different paths —
	// `derive` merges in place, `mapDerive` goes through
	// `replaceDeriveContext` and then gets copied onto the socket by the
	// `ElysiaWS` constructor, which is a second `=` that must not reparent it.
	for (const lane of ['derive', 'mapDerive'] as const)
		it(`survives a ${lane} returning an own __proto__`, async () => {
			const app = new Elysia()
				.use(websocket())
				[lane](({ request }: any) =>
					JSON.parse(request.headers.get('x-derive') ?? '{}')
				)
				.ws('/k', {
					message(ws: any) {
						ws.send(
							JSON.stringify({
								isAdmin: ws.isAdmin ?? null,
								status: typeof ws.status,
								send: typeof ws.send
							})
						)
					}
				})
				.listen(0)

			const server = app.server!
			const ws = new WebSocket(
				`ws://${server.hostname}:${server.port}/k`,
				{
					headers: { 'x-derive': '{"__proto__":{"isAdmin":true}}' }
				} as any
			)
			await wsOpen(ws)
			const frame = wsMessage(ws)
			ws.send('go')
			const body = JSON.parse(String((await frame).data))

			await wsClosed(ws)
			app.stop()

			expect(body.isAdmin).toBe(null)
			// the socket's own members must survive the merge
			expect(body.status).toBe('function')
			expect(body.send).toBe('function')
		})
})

describe('WebSocket dispatch admission', () => {
	// Bun's knobs bound the payload and the outbound buffer, never handler
	// concurrency, so one socket could pipeline frames into a slow `message`
	// and hold unbounded handlers in memory. Out-of-order completion below the
	// cap stays supported (test/ws/concurrency.test.ts).
	it('closes a socket that floods past the in-flight bound', async () => {
		let peak = 0
		let live = 0

		const app = new Elysia()
			.use(websocket())
			.ws('/o', {
				async message(ws: any) {
					if (++live > peak) peak = live
					await Bun.sleep(300)
					live--
					ws.send('late')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/o')
		await wsOpen(ws)

		const closed = wsClose(ws)
		for (let i = 0; i < 2000; i++) ws.send('x')

		const event = await closed
		app.stop()

		expect(event.code).toBe(1013)
		// the cap, not the client's send rate, is what bounded memory
		expect(peak).toBeLessThan(2000)
	})

	// An `async open` hook returns to the runtime at its first await, so the
	// first frames used to be handled against a half-initialised connection —
	// anything `open` sets up (a session, a subscription, a rate limiter) was
	// not there yet.
	it('holds message dispatch until an async open hook has finished', async () => {
		const order: string[] = []

		const app = new Elysia()
			.use(websocket())
			.ws('/z', {
				async open(ws: any) {
					order.push('open:start')
					await Bun.sleep(50)
					ws.raw.data.ready = true
					order.push('open:end')
				},
				message(ws: any) {
					order.push('message ready=' + !!ws.raw.data.ready)
					ws.send('done')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/z')
		await wsOpen(ws)
		const frame = wsMessage(ws)
		ws.send('go')
		await frame

		await wsClosed(ws)
		app.stop()

		expect(order).toEqual(['open:start', 'open:end', 'message ready=true'])
	})
})

describe('WebSocket inherited schema enforcement', () => {
	// A `guard` schema is a *centrally declared* authorization boundary: it is
	// written once so every route below it inherits the same input contract.
	// WS built its validators from the local hook only, so the one declaration
	// a team writes to lock a subtree down applied to the HTTP routes and
	// silently exempted the WebSocket ones.
	//
	// Every case asserts against an HTTP control declared from the *same*
	// guard, because the contract is parity — not a WS-specific rule.
	const guarded = (
		slot: 'headers' | 'query' | 'params',
		schema: any,
		path: string
	) =>
		new Elysia()
			.use(websocket())
			.guard({ [slot]: schema } as any)
			.get(path, () => 'ok')
			.ws(path, {
				message(ws: any) {
					ws.send('ok')
				}
			})
			.listen(0)

	it('rejects an upgrade violating a guard headers schema', async () => {
		const app = guarded(
			'headers',
			t.Object({ 'x-token': t.String() }),
			'/h'
		)

		const http = (await app.handle('/h')).status
		const ws = await upgradeStatus(app.server!, '/h')

		app.stop()

		expect(http).toBe(422)
		expect(ws).toBe(http)
	})

	it('rejects an upgrade violating a guard query schema', async () => {
		const app = guarded('query', t.Object({ name: t.String() }), '/q')

		const missingHttp = (await app.handle('/q')).status
		const missingWs = await upgradeStatus(app.server!, '/q')
		const okHttp = (await app.handle('/q?name=a')).status
		const okWs = await upgradeStatus(app.server!, '/q?name=a')

		app.stop()

		expect(missingHttp).toBe(422)
		expect(missingWs).toBe(missingHttp)
		expect(okHttp).toBe(200)
		expect(okWs).toBe(101)
	})

	it('rejects an upgrade violating a guard params schema', async () => {
		const app = guarded('params', t.Object({ id: t.Number() }), '/p/:id')

		const badHttp = (await app.handle('/p/abc')).status
		const badWs = await upgradeStatus(app.server!, '/p/abc')
		const okWs = await upgradeStatus(app.server!, '/p/1')

		app.stop()

		expect(badHttp).toBe(422)
		expect(badWs).toBe(badHttp)
		expect(okWs).toBe(101)
	})

	it('rejects a message frame violating a guard body schema', async () => {
		const app = new Elysia()
			.use(websocket())
			.guard({ body: t.Object({ a: t.Number() }) })
			.post('/b', ({ body }) => body)
			.ws('/b', {
				message(ws: any, message: any) {
					ws.send({ echoed: message })
				}
			})
			.listen(0)

		const http = await app.handle('/b', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ a: 'not-a-number' })
		})

		const ws = newWebsocket(app.server!, '/b')
		await wsOpen(ws)
		const frame = wsMessage(ws)
		ws.send(JSON.stringify({ a: 'not-a-number' }))
		const body = String((await frame).data)

		await wsClosed(ws)
		app.stop()

		expect(http.status).toBe(422)
		// the frame must never reach the handler verbatim
		expect(body).not.toContain('echoed')
		expect(body).toContain('must be number')
	})

	// Precedence is asserted against an HTTP control declared the same way, so
	// this can never encode a WS-specific rule: whatever HTTP decides for the
	// same two declarations is what WS must decide.
	it('lets a local schema replace an inherited one, exactly as HTTP does', async () => {
		const app = new Elysia()
			.use(websocket())
			.guard({ query: t.Object({ a: t.String() }) })
			.get('/r', { query: t.Object({ b: t.String() }) }, () => 'ok')
			.ws('/r', {
				query: t.Object({ b: t.String() }),
				message(ws: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const localHttp = (await app.handle('/r?b=1')).status
		const localWs = await upgradeStatus(app.server!, '/r?b=1')
		const inheritedHttp = (await app.handle('/r?a=1')).status
		const inheritedWs = await upgradeStatus(app.server!, '/r?a=1')

		app.stop()

		// default guard semantics: the local slot replaces the inherited one
		expect(localHttp).toBe(200)
		expect(localWs).toBe(101)
		expect(inheritedHttp).toBe(422)
		expect(inheritedWs).toBe(inheritedHttp)
	})

	it("intersects a `schema: 'merge'` guard with the local schema, exactly as HTTP does", async () => {
		const app = new Elysia()
			.use(websocket())
			.guard({ schema: 'merge', query: t.Object({ a: t.String() }) })
			.get('/m', { query: t.Object({ b: t.String() }) }, () => 'ok')
			.ws('/m', {
				query: t.Object({ b: t.String() }),
				message(ws: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const bothHttp = (await app.handle('/m?a=1&b=2')).status
		const bothWs = await upgradeStatus(app.server!, '/m?a=1&b=2')
		const localHttp = (await app.handle('/m?b=2')).status
		const localWs = await upgradeStatus(app.server!, '/m?b=2')

		app.stop()

		// merge semantics: both keys are required, on both transports
		expect(bothHttp).toBe(200)
		expect(bothWs).toBe(101)
		expect(localHttp).toBe(422)
		expect(localWs).toBe(localHttp)
	})
})

describe('WebSocket validator option parity', () => {
	// `normalize` and `sanitize` are app-level validator options with no
	// route-level override, so the same declaration must bind on both
	// transports. WS built its validators without them: `normalize: false`
	// (the "reject unknown keys" setting) silently kept stripping instead of
	// rejecting, and `sanitize` — an injection-defense hook, the whole point
	// of which is that it runs on *every* untrusted input — never ran on a
	// WebSocket at all. Each case carries an HTTP control declared from the
	// same config in the same app, so the assertion is parity, not a
	// WS-specific rule.
	it('rejects an unknown key under `normalize: false`, exactly as HTTP does', async () => {
		const app = new Elysia({ normalize: false })
			.use(websocket())
			.post(
				'/n',
				{ body: t.Object({ a: t.String() }) },
				({ body }) => body
			)
			.ws('/n', {
				body: t.Object({ a: t.String() }),
				message(ws: any, message: any) {
					ws.send({ echoed: message })
				}
			})
			.get('/nq', { query: t.Object({ a: t.String() }) }, () => 'ok')
			.ws('/nq', {
				query: t.Object({ a: t.String() }),
				message(ws: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const http = await app.handle('/n', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ a: 'hi', evil: 'x' })
		})

		const ws = newWebsocket(app.server!, '/n')
		await wsOpen(ws)
		const frame = wsMessage(ws)
		ws.send(JSON.stringify({ a: 'hi', evil: 'x' }))
		const body = String((await frame).data)
		await wsClosed(ws)

		const httpQuery = (await app.handle('/nq?a=hi&evil=x')).status
		const wsQuery = await upgradeStatus(app.server!, '/nq?a=hi&evil=x')

		app.stop()

		expect(http.status).toBe(422)
		// the extra key must be refused, not quietly dropped and handled
		expect(body).not.toContain('echoed')
		expect(body).toContain('must not have additional properties')

		expect(httpQuery).toBe(422)
		expect(wsQuery).toBe(httpQuery)
	})

	it('runs an app-level `sanitize` on WS input, exactly as HTTP does', async () => {
		const sanitize = (value: string) => value.replaceAll('<', '&lt;')

		let wsQuery: unknown
		const app = new Elysia({ sanitize })
			.use(websocket())
			.post(
				'/s',
				{ body: t.Object({ a: t.String() }) },
				({ body }) => body
			)
			.ws('/s', {
				body: t.Object({ a: t.String() }),
				message(ws: any, message: any) {
					ws.send(message)
				}
			})
			.get(
				'/sq',
				{ query: t.Object({ a: t.String() }) },
				({ query }) => query
			)
			.ws('/sq', {
				query: t.Object({ a: t.String() }),
				open(ws: any) {
					wsQuery = ws.query
					ws.send('ok')
				},
				message() {}
			})
			.listen(0)

		const http = await (
			await app.handle('/s', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ a: '<script>' })
			})
		).text()

		const ws = newWebsocket(app.server!, '/s')
		await wsOpen(ws)
		const frame = wsMessage(ws)
		ws.send(JSON.stringify({ a: '<script>' }))
		const body = String((await frame).data)
		await wsClosed(ws)

		const query = encodeURIComponent('<script>')
		const httpQuery = await (await app.handle(`/sq?a=${query}`)).text()
		const wsQ = newWebsocket(app.server!, `/sq?a=${query}`)
		await wsOpen(wsQ)
		await wsMessage(wsQ)
		await wsClosed(wsQ)

		app.stop()

		expect(http).toBe('{"a":"&lt;script>"}')
		expect(body).toBe(http)
		expect(httpQuery).toBe('{"a":"&lt;script>"}')
		expect(wsQuery).toEqual({ a: '&lt;script>' })
	})
})
