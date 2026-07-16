/**
 * Cross-transport lifecycle PARITY — HTTP per-route JIT vs WS hand-rolled.
 *
 * The per-route lifecycle is authored twice: JIT string codegen
 * (src/compile/handler/jit.ts) for HTTP, and hand-rolled interpreted closures
 * (src/ws/route.ts dispatchMessage / dispatchMessageSync) for WS. There is no
 * shared implementation, so drift needs direct coverage. This suite runs the
 * same scenario through both transports, asserting a shared expected value
 * where they agree and pinning current behavior where they diverge.
 *
 * A pinned divergence is a conscious tripwire. If the pinned behavior changes,
 * this test breaks on purpose so the transport contract is revisited explicitly.
 *
 * WS uses a real Bun.serve() + WebSocket client (see test/ws/*). Runs WITHOUT
 * NODE_ENV; production masking is in production-masking.test.ts.
 */

import { describe, it, expect } from 'bun:test'
import { Elysia, t, status } from '../../src'
import { ElysiaError } from '../../src/error'
import { newWebsocket, wsOpen, wsClosed } from '../ws/utils'

const Coded = t
	.Codec(t.String())
	.Decode((s: string) => Number(s.replace(/^n:/, '')))
	.Encode((n: number) => `n:${n}`)

// Collect frames a WS emits, resolving as soon as `expect` frames have arrived
// (deterministic — no behavior-blind sleep). `timeout` is only a failure
// fallback for the case where the expected count never arrives, so a genuinely
// broken transport surfaces as a wrong-length assertion instead of a hang.
function wsProbe(
	server: any,
	path: string,
	send: string,
	expect = 1,
	timeout = 3000
): Promise<{ opened: boolean; frames: string[]; close: { code: number } | null }> {
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
			// Resolve the moment the expected number of frames has arrived.
			if (frames.length >= expect) finish()
		}
		ws.onclose = (e) => {
			close = { code: e.code }
		}
		ws.onerror = () => {}
	})
}

describe('HTTP-vs-WS lifecycle parity', () => {
	// ------------------------------------------------------------------
	// Per-message hook stage order must match the HTTP per-route order
	// (transform -> beforeHandle -> handler -> afterHandle). WS additionally
	// runs transform+beforeHandle once at UPGRADE (they gate the upgrade),
	// so the per-message order is asserted from a separate counter that only
	// records the message dispatch, not the upgrade.
	// ------------------------------------------------------------------
	it('WS per-message stage order matches HTTP per-route stage order', async () => {
		// --- HTTP reference order ---
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

		// --- WS order ---
		// Record only message-phase entries so the upgrade-phase
		// transform/beforeHandle (which also fire) don't pollute the compare.
		let inMessage = false
		const wsOrder: string[] = []
		const wsApp = new Elysia()
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

		// Flip the flag right before sending: upgrade hooks have already run.
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
		// Same per-message stage order on WS.
		expect(wsOrder).toEqual([
			'transform',
			'beforeHandle',
			'handler',
			'afterHandle'
		])
	})

	// ------------------------------------------------------------------
	// Body validation failure — both transports emit RFC 9457 problem+json.
	// ( previously claimed WS was a bare string — since FIXED.)
	// ------------------------------------------------------------------
	it('body validation failure is RFC 9457 problem+json on BOTH transports', async () => {
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

		// Shared invariant: same problem-details shape + on/property.
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
		expect(await httpRes.text()).toBe('5')

		const wsApp = new Elysia()
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

	// ------------------------------------------------------------------
	// t.Date() response — coincidentally matches because JSON.stringify of a
	// Date yields the same ISO string HTTP encodes. Asserting the MATCH pins
	// the coincidence (a non-trivial codec below shows the real divergence).
	// ------------------------------------------------------------------
	it('t.Date() response body matches on both transports (coincidental)', async () => {
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

	// ==================================================================
	// PINNED DIVERGENCES — current behavior, tripwires for drift.
	// ==================================================================

	// ------------------------------------------------------------------
	// Current behavior: WS send does NOT run response codec Encode; HTTP does.
	// Same response schema + payload → success on HTTP, ValidationError on WS.
	// (jit.ts:926/931 EncodeFrom vs ws/context.ts #send Check-only + JSON.stringify)
	// ------------------------------------------------------------------
	it('Current behavior: response codec Encode runs on HTTP but not WS', async () => {
		const httpApp = new Elysia().get(
			'/c',
			{ response: t.Object({ v: Coded }) },
			() => ({ v: 42 })
		)
		const httpRes = await httpApp.handle(new Request('http://localhost/c'))
		expect(httpRes.status).toBe(200)
		// HTTP encodes number 42 -> "n:42"
		expect(await httpRes.text()).toBe('{"v":"n:42"}')

		const wsApp = new Elysia()
			.ws('/c', {
				response: t.Object({ v: Coded }),
				message(ws: any) {
					ws.send({ v: 42 })
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/c', 'go')
		wsApp.stop()

		// DIVERGENCE : WS never Encodes. The codec's underlying type is
		// String, so Check(rawNumber) fails → WS emits a validation error frame
		// instead of the encoded body. If WS ever gains Encode-on-send this
		// assertion must flip to the shared "{"v":"n:42"}" expectation.
		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toBe('{"v":"n:42"}')
		expect(frames[0]).toContain('must be string')
	})

	// ------------------------------------------------------------------
	// Current behavior: afterHandle return value — HTTP replaces the
	// response, WS discards it. (jit.ts reassigns _r from mapAfterHandle; WS
	// route.ts:458-461 awaits afterHandles only for timing, ignores the return.)
	// ------------------------------------------------------------------
	it('Current behavior: afterHandle return replaces response on HTTP, discarded on WS', async () => {
		const httpApp = new Elysia().get(
			'/after',
			{ afterHandle: () => 'AFTER-WINS' },
			() => 'handler-body'
		)
		const httpRes = await httpApp.handle(
			new Request('http://localhost/after')
		)
		// HTTP: afterHandle return wins
		expect(await httpRes.text()).toBe('AFTER-WINS')

		const wsApp = new Elysia()
			.ws('/after', {
				afterHandle: () => 'AFTER-WINS' as any,
				message(ws: any) {
					ws.send('handler-body')
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/after', 'go')
		wsApp.stop()

		// DIVERGENCE: WS keeps the handler body; afterHandle return is dropped.
		expect(frames).toEqual(['handler-body'])
	})

	// ------------------------------------------------------------------
	// Parity: thrown status() preserves both the
	// status code and the response value on BOTH transports. HTTP unwraps
	// ElysiaStatus into a raw `418 "teapot"` response; WS emits the structured
	// frame `{status,error}` — the SAME shape a RETURNED status() emits over WS
	// (ws/context.ts #prepare), so thrown now matches returned. wsErrorFrame()
	// gained an ElysiaStatus branch (ws/route.ts). Each transport carries status
	// + value in its own native form; the shared invariant is that neither is
	// silently dropped (previously WS coerced to "[object Object]").
	// ------------------------------------------------------------------
	it('PARITY: thrown status() preserves status + value on HTTP and WS', async () => {
		const httpApp = new Elysia().get('/st', () => {
			throw status(418, 'teapot')
		})
		const httpRes = await httpApp.handle(new Request('http://localhost/st'))
		// HTTP: raw unwrapped status + body.
		expect(httpRes.status).toBe(418)
		expect(await httpRes.text()).toBe('teapot')

		const wsApp = new Elysia()
			.ws('/st', {
				message() {
					throw status(418, 'teapot')
				}
			})
			.listen(0)
		const { frames: thrownFrames } = await wsProbe(wsApp.server!, '/st', 'go')

		// WS: structured frame carrying the same status + value. Assert it equals
		// what a RETURNED status() emits — thrown and returned must agree.
		const returnedApp = new Elysia()
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
		// Shared invariant: status + value survive on WS (native structured form).
		expect(wsBody).toEqual({ status: 418, error: 'teapot' })
		// Thrown status() serializes identically to returned status() on WS.
		expect(thrownFrames).toEqual(returnedFrames)
	})

	// ------------------------------------------------------------------
	// Parity: WS errors are now RFC 9457 problem+json,
	// at parity with HTTP (maintainer 2026-07-06). A generic thrown Error yields
	// the SAME body byte-for-byte on both transports — problem+json with `detail`
	// in dev. wsErrorFrame() reuses HTTP's internalServerErrorBody() builder, so
	// the two can't drift. HTTP is probed live here (the reference); the WS frame
	// must equal the HTTP wire body exactly. Production masking is asserted in
	// production-masking.test.ts.
	// ------------------------------------------------------------------
	it('PARITY: uncaught Error is the same problem+json body on HTTP and WS (dev)', async () => {
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
			.ws('/e', {
				message() {
					throw new Error('kaboom')
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/e', 'go')
		wsApp.stop()

		// PARITY: WS emits the exact HTTP problem+json body, not a bare message.
		expect(frames).toHaveLength(1)
		expect(frames[0]).toBe(httpText)
	})

	// ------------------------------------------------------------------
	// PARITY ( defect): a NON-Error throw (`throw 'x'`, `throw {..}`) never
	// leaks its own content on either transport, even in dev, AND now emits the
	// SAME body byte-for-byte (WS errors -> problem+json, maintainer 2026-07-06).
	// HTTP's fallbackErrorResponse routes non-Error, non-status throws to the
	// generic internalServerErrorResponse; internalServerErrorBody only adds
	// `detail` when `error.message != null`, and a bare string/plain-object has no
	// `.message`, so the thrown value is masked in dev too. wsErrorFrame used to
	// emit `error + ''` (leaking "secret-string" / "[object Object]"); it now
	// reuses internalServerErrorBody so the WS frame equals the HTTP body exactly.
	//
	// HTTP is the reference here; we probe it live in this same test rather than
	// hardcoding, so if HTTP's dev policy ever changes this breaks on purpose.
	// ------------------------------------------------------------------
	it('PARITY: non-Error throw (string) is the same problem+json body on HTTP and WS (dev), no leak', async () => {
		const httpApp = new Elysia().get('/ts', () => {
			throw 'secret-string'
		})
		const httpRes = await httpApp.handle(
			new Request('http://localhost/ts')
		)
		expect(httpRes.status).toBe(500)
		const httpText = await httpRes.text()
		// HTTP reference: the thrown string is absent from the dev body.
		expect(httpText).not.toContain('secret-string')

		const wsApp = new Elysia()
			.ws('/ts', {
				message() {
					throw 'secret-string'
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/ts', 'go')
		wsApp.stop()

		// PARITY: WS emits the exact HTTP body — no thrown-string content on the wire.
		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toContain('secret-string')
		expect(frames[0]).toBe(httpText)
	})

	it('PARITY: non-Error throw (plain object) is the same problem+json body on HTTP and WS (dev), no leak', async () => {
		const httpApp = new Elysia().get('/to', () => {
			throw { password: 'secret-object' }
		})
		const httpRes = await httpApp.handle(
			new Request('http://localhost/to')
		)
		expect(httpRes.status).toBe(500)
		const httpText = await httpRes.text()
		// HTTP reference: the thrown object's contents are absent from the body.
		expect(httpText).not.toContain('secret-object')

		const wsApp = new Elysia()
			.ws('/to', {
				message() {
					throw { password: 'secret-object' }
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/to', 'go')
		wsApp.stop()

		// PARITY: WS emits the exact HTTP body — no object content nor
		// "[object Object]" on the wire.
		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toContain('secret-object')
		expect(frames[0]).not.toContain('[object Object]')
		expect(frames[0]).toBe(httpText)
	})

	// ------------------------------------------------------------------
	// close-race ( 2026-07-06): the WS error frame is sent SYNCHRONOUSLY.
	// Making wsErrorFrame async (to await error.toResponse().text() for byte-parity)
	// regressed this: the frame send became awaited, so a close the handler queues
	// in the SAME turn (`finally { queueMicrotask(() => ws.close()) }`) wins the
	// microtask race and the frame is silently dropped ( repro: frames=[]).
	// The fix makes every sync-computable arm return a string sent in-turn; the
	// error frame MUST still arrive before the close takes effect.
	//
	// wsProbe resolves the moment `expect` frames arrive, so a dropped frame
	// surfaces as frames.length 0 (timeout) rather than a hang.
	// ------------------------------------------------------------------
	it('close-race: generic Error frame survives a close queued in finally ( 2026-07-06)', async () => {
		const wsApp = new Elysia()
			.ws('/race', {
				message(ws: any) {
					try {
						throw new Error('race')
					} finally {
						// User queues a close in the same synchronous turn as the throw.
						queueMicrotask(() => ws.close())
					}
				}
			})
			.listen(0)

		const { frames } = await wsProbe(wsApp.server!, '/race', 'go')
		wsApp.stop()

		// The problem+json error frame must NOT be dropped by the queued close.
		expect(frames).toHaveLength(1)
		const body = JSON.parse(frames[0])
		expect(body).toMatchObject({ status: 500, detail: 'race' })
	})

	// (b) Same race, but throwing an ElysiaError subclass — this is arm 3
	// (error.toResponse), the arm that was async before the fix. A field-only
	// subclass uses the BASE ElysiaError.toResponse, so wsErrorFrame reconstructs
	// its problem+json body synchronously (problemBody) → frame beats the close.
	// Byte-parity with the HTTP wire is asserted alongside.
	it('close-race: thrown ElysiaError subclass frame survives a queued close, byte-equal to HTTP ( 2026-07-06)', async () => {
		class Teapot extends ElysiaError {
			status = 418 as any
			problemType = 'teapot'
			problemTitle = 'I am a teapot'
			constructor() {
				super('short and stout')
			}
		}

		// HTTP reference body for the same throw.
		const httpApp = new Elysia().get('/teapot', () => {
			throw new Teapot()
		})
		const httpRes = await httpApp.handle(
			new Request('http://localhost/teapot')
		)
		expect(httpRes.status).toBe(418)
		const httpText = await httpRes.text()

		const wsApp = new Elysia()
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

		// Frame survives the queued close AND is byte-identical to HTTP's wire body.
		expect(frames).toHaveLength(1)
		expect(frames[0]).toBe(httpText)
		expect(JSON.parse(frames[0])).toEqual({
			type: 'teapot',
			title: 'I am a teapot',
			status: 418
		})
	})
})
