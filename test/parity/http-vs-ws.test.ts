import { describe, it, expect } from 'bun:test'
import { Elysia, problem, t, status } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { ElysiaError } from '../../src/error'
import { newWebsocket, wsOpen, wsClosed } from '../ws/utils'

const Coded = t
	.Codec(t.String())
	.Decode((s: string) => Number(s.replace(/^n:/, '')))
	.Encode((n: number) => `n:${n}`)

function wsProbe(
	server: any,
	path: string,
	send: string,
	expect = 1,
	timeout = 3000
): Promise<{
	opened: boolean
	frames: string[]
	close: { code: number } | null
}> {
	return new Promise((resolve) => {
		const ws = newWebsocket(server, path)
		const frames: string[] = []
		let opened = false
		let close: { code: number } | null = null
		let done = false

		const finish = () => {
			if (done) return
			done = true
			clearTimeout(timer)
			try {
				ws.close()
			} catch {}
			resolve({ opened, frames, close })
		}

		const timer = setTimeout(finish, timeout)

		ws.onopen = () => {
			opened = true
			ws.send(send)
		}
		ws.onmessage = (e) => {
			frames.push(String(e.data))
			if (frames.length >= expect) finish()
		}
		ws.onclose = (e) => {
			close = { code: e.code }
		}
		ws.onerror = () => {}
	})
}

describe('HTTP and WebSocket lifecycle', () => {
	it('WS per-message stage order matches HTTP per-route stage order', async () => {
		const httpOrder: string[] = []
		const httpApp = new Elysia().get(
			'/order',
			{
				transform() {
					httpOrder.push('transform')
				},
				beforeHandle() {
					httpOrder.push('beforeHandle')
				},
				afterHandle() {
					httpOrder.push('afterHandle')
				}
			},
			() => {
				httpOrder.push('handler')
				return 'ok'
			}
		)
		await httpApp.handle(new Request('http://localhost/order'))

		// Ignore upgrade-phase calls; compare message handling only.
		let inMessage = false
		const wsOrder: string[] = []
		const wsApp = new Elysia()
			.use(websocket())
			.ws('/order', {
				transform() {
					if (inMessage) wsOrder.push('transform')
				},
				beforeHandle() {
					if (inMessage) wsOrder.push('beforeHandle')
				},
				afterHandle() {
					wsOrder.push('afterHandle')
				},
				message(ws: any) {
					wsOrder.push('handler')
					ws.send('ok')
				}
			})
			.listen(0)

		const ws = newWebsocket(wsApp.server!, '/order')
		await wsOpen(ws)
		inMessage = true
		const got = new Promise<void>((resolve) => {
			ws.onmessage = () => resolve()
		})
		ws.send('x')
		await got
		await new Promise((r) => setTimeout(r, 20))

		await wsClosed(ws)
		wsApp.stop()

		expect(httpOrder).toEqual([
			'transform',
			'beforeHandle',
			'handler',
			'afterHandle'
		])
		expect(wsOrder).toEqual([
			'transform',
			'beforeHandle',
			'handler',
			'afterHandle'
		])
	})

	it('body validation failure is RFC 9457 problem+json on both transports', async () => {
		const httpApp = new Elysia().post(
			'/v',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => body.n
		)
		const httpRes = await httpApp.handle(
			new Request('http://localhost/v', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ n: 'nope' })
			})
		)
		expect(httpRes.status).toBe(422)
		const httpBody = JSON.parse(await httpRes.text())

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/v', {
				body: t.Object({ n: t.Number() }),
				message(ws: any) {
					ws.send(String(ws.body.n))
				}
			})
			.listen(0)

		const { frames } = await wsProbe(
			wsApp.server!,
			'/v',
			JSON.stringify({ n: 'nope' })
		)
		wsApp.stop()

		expect(frames).toHaveLength(1)
		const wsBody = JSON.parse(frames[0])

		const shape = (b: any) => ({
			type: b.type,
			title: b.title,
			status: b.status,
			on: b.on,
			property: b.property
		})
		const expected = {
			type: 'validation',
			title: 'Validation Error',
			status: 422,
			on: 'body',
			property: '/n'
		}
		expect(shape(httpBody)).toEqual(expected)
		expect(shape(wsBody)).toEqual(expected)
	})

	it('valid body passes validation identically on both transports', async () => {
		const httpApp = new Elysia().post(
			'/v',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => String(body.n)
		)
		const httpRes = await httpApp.handle(
			new Request('http://localhost/v', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ n: 5 })
			})
		)
		await expect(httpRes.text()).resolves.toBe('5')

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/v', {
				body: t.Object({ n: t.Number() }),
				message(ws: any) {
					ws.send(String(ws.body.n))
				}
			})
			.listen(0)
		const { frames } = await wsProbe(
			wsApp.server!,
			'/v',
			JSON.stringify({ n: 5 })
		)
		wsApp.stop()

		expect(frames).toEqual(['5'])
	})

	it('Date response bodies match even though only HTTP applies response encoding', async () => {
		const iso = '2020-01-01T00:00:00.000Z'

		const httpApp = new Elysia().get(
			'/date',
			{ response: t.Object({ when: t.Date() }) },
			() => ({ when: new Date(iso) })
		)
		const httpRes = await httpApp.handle(
			new Request('http://localhost/date')
		)
		const httpBody = await httpRes.text()

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/date', {
				response: t.Object({ when: t.Date() }),
				message(ws: any) {
					ws.send({ when: new Date(iso) })
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/date', 'go')
		wsApp.stop()

		expect(httpBody).toBe(`{"when":"${iso}"}`)
		expect(frames).toEqual([`{"when":"${iso}"}`])
	})

	it('encodes response codecs on HTTP but validates raw values on WebSocket', async () => {
		const httpApp = new Elysia().get(
			'/c',
			{ response: t.Object({ v: Coded }) },
			() => ({ v: 42 })
		)
		const httpRes = await httpApp.handle(new Request('http://localhost/c'))
		expect(httpRes.status).toBe(200)
		await expect(httpRes.text()).resolves.toBe('{"v":"n:42"}')

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/c', {
				response: t.Object({ v: Coded }),
				message(ws: any) {
					ws.send({ v: 42 })
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/c', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toBe('{"v":"n:42"}')
		expect(frames[0]).toContain('must be string')
	})

	it('uses afterHandle return values on HTTP but not WebSocket', async () => {
		const httpApp = new Elysia().get(
			'/after',
			{ afterHandle: () => 'AFTER-WINS' },
			() => 'handler-body'
		)
		const httpRes = await httpApp.handle(
			new Request('http://localhost/after')
		)
		await expect(httpRes.text()).resolves.toBe('AFTER-WINS')

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/after', {
				afterHandle: () => 'AFTER-WINS' as any,
				message(ws: any) {
					ws.send('handler-body')
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/after', 'go')
		wsApp.stop()

		expect(frames).toEqual(['handler-body'])
	})

	it('preserves a thrown status code and value on HTTP and WebSocket', async () => {
		const httpApp = new Elysia().get('/st', () => {
			throw status(418, 'teapot')
		})
		const httpRes = await httpApp.handle(new Request('http://localhost/st'))
		expect(httpRes.status).toBe(418)
		await expect(httpRes.text()).resolves.toBe('teapot')

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/st', {
				message() {
					throw status(418, 'teapot')
				}
			})
			.listen(0)
		const { frames: thrownFrames } = await wsProbe(
			wsApp.server!,
			'/st',
			'go'
		)

		const returnedApp = new Elysia()
			.use(websocket())
			.ws('/ret', {
				message() {
					return status(418, 'teapot')
				}
			})
			.listen(0)
		const { frames: returnedFrames } = await wsProbe(
			returnedApp.server!,
			'/ret',
			'go'
		)
		wsApp.stop()
		returnedApp.stop()

		expect(thrownFrames).toHaveLength(1)
		const wsBody = JSON.parse(thrownFrames[0])
		expect(wsBody).toEqual({ status: 418, error: 'teapot' })
		expect(thrownFrames).toEqual(returnedFrames)
	})

	it('serializes uncaught development errors identically on HTTP and WebSocket', async () => {
		const httpApp = new Elysia().get('/e', () => {
			throw new Error('kaboom')
		})
		const httpRes = await httpApp.handle(new Request('http://localhost/e'))
		expect(httpRes.status).toBe(500)
		expect(httpRes.headers.get('content-type')).toBe(
			'application/problem+json'
		)
		const httpText = await httpRes.text()
		expect(JSON.parse(httpText)).toMatchObject({
			status: 500,
			detail: 'kaboom'
		})

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/e', {
				message() {
					throw new Error('kaboom')
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/e', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).toBe(httpText)
	})

	it('masks a thrown string identically on HTTP and WebSocket', async () => {
		const httpApp = new Elysia().get('/ts', () => {
			throw 'secret-string'
		})
		const httpRes = await httpApp.handle(new Request('http://localhost/ts'))
		expect(httpRes.status).toBe(500)
		const httpText = await httpRes.text()
		expect(httpText).not.toContain('secret-string')

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/ts', {
				message() {
					throw 'secret-string'
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/ts', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toContain('secret-string')
		expect(frames[0]).toBe(httpText)
	})

	it('masks a thrown object identically on HTTP and WebSocket', async () => {
		const httpApp = new Elysia().get('/to', () => {
			throw { password: 'secret-object' }
		})
		const httpRes = await httpApp.handle(new Request('http://localhost/to'))
		expect(httpRes.status).toBe(500)
		const httpText = await httpRes.text()
		expect(httpText).not.toContain('secret-object')

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/to', {
				message() {
					throw { password: 'secret-object' }
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/to', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toContain('secret-object')
		expect(frames[0]).not.toContain('[object Object]')
		expect(frames[0]).toBe(httpText)
	})

	it('sends an Error frame before a close queued in finally', async () => {
		const wsApp = new Elysia()
			.use(websocket())
			.ws('/race', {
				message(ws: any) {
					try {
						throw new Error('race')
					} finally {
						queueMicrotask(() => ws.close())
					}
				}
			})
			.listen(0)

		const { frames } = await wsProbe(wsApp.server!, '/race', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		const body = JSON.parse(frames[0])
		expect(body).toMatchObject({ status: 500, detail: 'race' })
	})

	it('sends an ElysiaError frame before a queued close and matches HTTP', async () => {
		class Teapot extends ElysiaError {
			status = 418 as any
			readonly code = 'teapot'
			constructor() {
				super('short and stout')
			}
		}

		const httpApp = new Elysia().get('/teapot', () => {
			throw new Teapot()
		})
		const httpRes = await httpApp.handle(
			new Request('http://localhost/teapot')
		)
		expect(httpRes.status).toBe(418)
		const httpText = await httpRes.text()

		const wsApp = new Elysia()
			.use(websocket())
			.ws('/teapot', {
				message(ws: any) {
					try {
						throw new Teapot()
					} finally {
						queueMicrotask(() => ws.close())
					}
				}
			})
			.listen(0)

		const { frames } = await wsProbe(wsApp.server!, '/teapot', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).toBe(httpText)
		// `code` is the slug, `type` mirrors it, and `title` is derived from the
		// status now that `problemTitle` is gone
		expect(JSON.parse(frames[0])).toEqual({
			type: 'teapot',
			code: 'teapot',
			title: "I'm a teapot",
			status: 418
		})
	})
})

// Bun normalizes the request target, so a route path containing a character
// outside the URL-safe set only ever arrives percent-encoded. HTTP registers
// both the raw and the `encodeURI` twin; WS registered only the raw key, so the
// one form that can actually arrive was the one form not in the map. That is a
// route-level authorization boundary when an overlapping dynamic route exists:
// the upgrade silently lands on the more permissive catch-all handler, skipping
// the specific socket's own hooks.
describe('path encoding parity', () => {
	const encoded = encodeURI('/ws/กข')

	// This is the actual "parity" claim of the describe block: HTTP already
	// resolved the encoded twin to the static route before this fix (that
	// half is a control, not a regression check — see
	// test/regression/routing.test.ts:40 for that behavior pinned on its
	// own). WS did not, and silently fell through to the more permissive
	// dynamic handler instead. Asserting both transports land on the same
	// handler for the identical encoded request is what gives this test
	// teeth against the WS-side fix — reverting it changes `frames[0]` from
	// 'static' to 'dynamic' while the HTTP half stays green.
	it('HTTP and WS resolve the encoded form to the same route', async () => {
		const app = new Elysia()
			.use(websocket())
			.get('/ws/กข', () => 'static')
			.get('/ws/:id', () => 'dynamic')
			.ws('/ws/กข', {
				open: (ws: any) => ws.send('static'),
				message() {}
			})
			.ws('/ws/:id', {
				open: (ws: any) => ws.send('dynamic'),
				message() {}
			})
			.listen(0)

		try {
			await expect((await app.handle('/ws/กข')).text()).resolves.toBe(
				'static'
			)
			await expect((await app.handle(encoded)).text()).resolves.toBe(
				'static'
			)
			await expect((await app.handle('/ws/zz')).text()).resolves.toBe(
				'dynamic'
			)

			const { opened, frames } = await wsProbe(app.server!, encoded, '')
			expect(opened).toBe(true)
			expect(frames[0]).toBe('static')
		} finally {
			app.stop()
		}
	})

	it('WS resolves the encoded form instead of falling through to /ws/:id', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws/กข', {
				open: (ws: any) => ws.send('static'),
				message() {}
			})
			.ws('/ws/:id', {
				open: (ws: any) => ws.send('dynamic'),
				message() {}
			})
			.listen(0)

		try {
			for (const path of [encoded, encoded + '/', '/ws/กข']) {
				const { opened, frames } = await wsProbe(app.server!, path, '')

				expect(opened).toBe(true)
				expect(frames[0]).toBe('static')
			}

			// The dynamic route must still win for anything it alone matches
			const dynamic = await wsProbe(app.server!, '/ws/zz', '')
			expect(dynamic.frames[0]).toBe('dynamic')
		} finally {
			app.stop()
		}
	})

	it('WS reaches an encoded route with no dynamic sibling to fall through to', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws/กข', {
				open: (ws: any) => ws.send('static'),
				message() {}
			})
			.listen(0)

		try {
			const { opened, frames } = await wsProbe(app.server!, encoded, '')

			expect(opened).toBe(true)
			expect(frames[0]).toBe('static')
		} finally {
			app.stop()
		}
	})

	// The dynamic WS branch had the identical hole: it added only the raw path
	// to the router, so an encoded literal segment never matched.
	it('WS resolves an encoded literal segment of a dynamic route', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws/ก/:id', {
				open: (ws: any) => ws.send('dynamic-encoded'),
				message() {}
			})
			.listen(0)

		try {
			const { opened, frames } = await wsProbe(
				app.server!,
				encodeURI('/ws/ก/7'),
				''
			)

			expect(opened).toBe(true)
			expect(frames[0]).toBe('dynamic-encoded')
		} finally {
			app.stop()
		}
	})
})

// The claim checks `type` is a string, the copy checks `code`; reading either
// again to adopt it lets a getter swap in anything past that check. The
// transport-level read-once pins live in test/ws/error-redaction.test.ts
describe('problem members are read once', () => {
	it('adopts the checked `type` and `code` into a hook-made problem', async () => {
		class ForeignFlip extends Error {
			readonly status = 409
			typeReads = 0
			codeReads = 0

			get type(): any {
				return this.typeReads++ === 0
					? 'FOREIGN_FLIP'
					: { marker: 'second-read' }
			}

			get code(): any {
				return this.codeReads++ === 0
					? 'foreign-code'
					: { marker: 'second-read' }
			}
		}

		const response = await new Elysia()
			.onError(() => problem(409))
			.get('/', () => {
				throw new ForeignFlip('flip-message')
			})
			.handle(new Request('http://localhost/'))

		expect(await response.json()).toEqual({
			type: 'FOREIGN_FLIP',
			code: 'foreign-code',
			title: 'Conflict',
			status: 409
		})
	})
})

// the first mapResponse hook that answers wins on HTTP; WS must not feed
// that answer into the next hook, or a plugin's mapper rewraps the route's
describe('HTTP and WebSocket mapResponse chains', () => {
	const m1 = ({ responseValue }: any) =>
		typeof responseValue === 'string' ? `m1(${responseValue})` : undefined
	const m2 = ({ responseValue }: any) =>
		typeof responseValue === 'string' ? `m2(${responseValue})` : undefined
	const mapResponse = [m1, m2]

	it('stops at the first defined mapping on both transports', async () => {
		const app = new Elysia()
			.use(websocket())
			.get('/h', { mapResponse }, () => 'v')
			.get('/he', { mapResponse, error: () => 'handled' }, () => {
				throw new Error('x')
			})
			.ws('/w', { mapResponse, message: () => 'v' })
			.ws('/wg', {
				mapResponse,
				message: function* () {
					yield 'a'
					yield 'b'
				}
			})
			.ws('/we', {
				mapResponse,
				error: () => 'handled',
				message() {
					throw new Error('x')
				}
			})
			.listen(0)

		const plain = await wsProbe(app.server!, '/w', 'go')
		const generator = await wsProbe(app.server!, '/wg', 'go', 2)
		const hook = await wsProbe(app.server!, '/we', 'go')
		const http = await app.handle(new Request('http://localhost/h'))
		const httpError = await app.handle(new Request('http://localhost/he'))
		app.stop()

		expect(await http.text()).toBe('m1(v)')
		expect(await httpError.text()).toBe('m1(handled)')
		expect(plain.frames).toEqual(['m1(v)'])
		expect(generator.frames).toEqual(['m1(a)', 'm1(b)'])
		expect(hook.frames).toEqual(['m1(handled)'])
	})
})

// afterResponse runs exactly once on every exit on HTTP; a WS frame is the
// unit the hook counts, so it runs once per frame whatever the exit, and only
// after the answer or error frame has been sent
describe('HTTP and WebSocket afterResponse on every exit', () => {
	type Hooks = Record<string, unknown>
	const cases: Record<string, (ws: boolean) => Hooks> = {
		ok: () => ({}),
		// answers per message only: at the upgrade `body` is empty
		beforeHandleShort: () => ({
			beforeHandle: ({ body }: any) => (body ? 'short' : undefined)
		}),
		parseFail: () => ({
			parse() {
				throw new Error('parse')
			}
		}),
		validationFail: () => ({ body: t.Object({ n: t.Number() }) }),
		throw: () => ({
			handler() {
				throw new Error('boom')
			}
		}),
		reject: () => ({
			async handler() {
				throw new Error('boom')
			}
		}),
		afterHandleThrow: () => ({
			afterHandle() {
				throw new Error('after')
			}
		}),
		mapResponseThrow: () => ({
			mapResponse() {
				throw new Error('map')
			}
		})
	}

	it('runs afterResponse once per request and once per frame', async () => {
		const after: Record<string, number> = {}
		const afterHandle: Record<string, number> = {}
		const bodies: Record<string, unknown> = {}
		const count = (name: string) => (ws: any) => {
			after[name] = (after[name] ?? 0) + 1
			bodies[name] = ws.body
			if (ws.raw) ws.send('after')
		}

		let app: any = new Elysia().use(websocket())
		for (const [name, make] of Object.entries(cases)) {
			const { handler = () => 'r', ...hooks } = make(false) as any
			app = app
				.post(
					`/${name}`,
					{
						...hooks,
						afterHandle:
							hooks.afterHandle ??
							(() =>
								void (afterHandle[`h:${name}`] =
									(afterHandle[`h:${name}`] ?? 0) + 1)),
						afterResponse: count(`h:${name}`)
					},
					handler
				)
				.ws(`/${name}`, {
					...hooks,
					afterHandle:
						hooks.afterHandle ??
						(() =>
							void (afterHandle[`w:${name}`] =
								(afterHandle[`w:${name}`] ?? 0) + 1)),
					afterResponse: count(`w:${name}`),
					message: handler
				})
		}
		app.listen(0)

		const frames: Record<string, string[]> = {}
		const expectedFrames: Record<string, number> = {
			ok: 2,
			beforeHandleShort: 2,
			afterHandleThrow: 3
		}
		for (const name of Object.keys(cases))
			frames[name] = (
				await wsProbe(
					app.server!,
					`/${name}`,
					'hi',
					expectedFrames[name] ?? 2,
					500
				)
			).frames

		const statuses: Record<string, number> = {}
		for (const name of Object.keys(cases)) {
			if (name === 'parseFail') continue
			const res = await app.handle(
				new Request(`http://localhost/${name}`, {
					method: 'POST',
					body: 'hi'
				})
			)
			statuses[name] = res.status
		}
		// afterResponse is scheduled after the HTTP response is handed back
		await Bun.sleep(10)
		app.stop()

		const error = (status: number) =>
			expect.stringContaining(`"status":${status}`)
		expect(frames).toEqual({
			ok: ['r', 'after'],
			beforeHandleShort: ['short', 'after'],
			parseFail: [error(500), 'after'],
			validationFail: [error(422), 'after'],
			throw: [error(500), 'after'],
			reject: [error(500), 'after'],
			afterHandleThrow: ['r', error(500), 'after'],
			mapResponseThrow: [error(500), 'after']
		})
		expect(statuses).toEqual({
			ok: 200,
			beforeHandleShort: 200,
			validationFail: 422,
			throw: 500,
			reject: 500,
			afterHandleThrow: 500,
			mapResponseThrow: 500
		})

		const once: Record<string, number> = {}
		for (const name of Object.keys(cases)) {
			if (name !== 'parseFail') once[`h:${name}`] = 1
			once[`w:${name}`] = 1
		}
		expect(after).toEqual(once)

		// a beforeHandle answer still reaches afterHandle, as on HTTP
		expect(afterHandle['h:beforeHandleShort']).toBe(1)
		expect(afterHandle['w:beforeHandleShort']).toBe(1)

		// nothing was accepted as the body when parsing or validation failed
		expect(bodies['w:parseFail']).toBeUndefined()
		expect(bodies['w:validationFail']).toBeUndefined()
		expect(bodies['w:throw']).toBe('hi')
	})
})

// every HTTP answer from the upgrade lane finalizes as on HTTP: the route's
// mapResponse runs, pending `set` state is kept, cookies are signed
describe('HTTP and WebSocket upgrade answers', () => {
	const seen: string[] = []
	const kind = (value: unknown) =>
		value instanceof Response ? 'Response' : typeof value
	const mapResponse = ({ responseValue, set }: any) => {
		seen.push(`${kind(responseValue)}:${set.status}`)
		if (typeof responseValue === 'string') return `MAPPED:${responseValue}`
	}
	const cases: Record<string, Record<string, unknown>> = {
		early: {
			beforeHandle({ set }: any) {
				set.headers['x-pending'] = '1'
				return 'denied'
			}
		},
		response: {
			beforeHandle({ set }: any) {
				set.headers['x-pending'] = '1'
				return new Response('no', { status: 403 })
			}
		},
		hookReturn: {
			beforeHandle() {
				throw new Error('x')
			},
			error: () => 'handled'
		},
		thrown: {
			beforeHandle() {
				throw new Error('x')
			}
		}
	}

	it('finalize a beforeHandle answer, an error hook answer and a thrown error alike', async () => {
		let app: any = new Elysia().use(websocket())
		for (const [name, hooks] of Object.entries(cases))
			app = app
				.get(`/${name}`, { ...hooks, mapResponse }, () => 'handler')
				.ws(`/${name}`, { ...hooks, mapResponse, message() {} })

		const answer = async (name: string, upgrade: boolean) => {
			seen.length = 0
			const res = await app.handle(
				new Request(`http://localhost/${name}`, {
					headers: upgrade ? { upgrade: 'websocket' } : {}
				})
			)

			return {
				status: res.status,
				body: (await res.text()).slice(0, 12),
				pending: res.headers.get('x-pending'),
				seen: [...seen]
			}
		}

		const http: Record<string, unknown> = {}
		const ws: Record<string, unknown> = {}
		for (const name of Object.keys(cases)) {
			http[name] = await answer(name, false)
			ws[name] = await answer(name, true)
		}

		expect(http).toEqual({
			early: {
				status: 200,
				body: 'MAPPED:denie',
				pending: '1',
				seen: ['string:undefined']
			},
			response: {
				status: 403,
				body: 'no',
				pending: '1',
				seen: ['Response:undefined']
			},
			hookReturn: {
				status: 500,
				body: 'MAPPED:handl',
				pending: null,
				seen: ['string:500']
			},
			thrown: {
				status: 500,
				body: '{"type":"int',
				pending: null,
				seen: ['Response:500']
			}
		})
		expect(ws).toEqual(http)
	})
})

describe('HTTP and WebSocket derive of a function', () => {
	// a derive may return a function carrying properties; HTTP merges its own
	// keys, so the WS upgrade must too or `tag` is missing on one lane only
	const fn = () => Object.assign(() => {}, { tag: 'fn' })

	for (const [name, register] of [
		['derive', (app: any) => app.derive(fn)],
		['mapDerive', (app: any) => app.mapDerive(fn)]
	] as const)
		it(`${name} exposes a function result's own properties on both lanes`, async () => {
			const beforeHandle = ({ tag }: any) => `tag:${tag}`
			const app = register(new Elysia().use(websocket()))
				.get('/', { beforeHandle }, () => 'handler')
				.ws('/', { beforeHandle, message() {} })

			const answer = (upgrade: boolean) =>
				app
					.handle(
						new Request('http://localhost/', {
							headers: upgrade ? { upgrade: 'websocket' } : {}
						})
					)
					.then((res: Response) => res.text())

			expect(await answer(false)).toBe('tag:fn')
			expect(await answer(true)).toBe('tag:fn')
		})
})
