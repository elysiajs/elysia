/**
 * Cross-path lifecycle PARITY — HTTP arms only.
 *
 * Finding: maintainability-arch-2 (design/review-stable/findings/maintainability-arch-2.md)
 *
 * Elysia implements the request lifecycle across multiple arms:
 *   1. per-route handler — JIT string codegen (src/compile/handler/jit.ts)
 *   2. root dispatcher — interpreted (src/handler/fetch.ts): onRequest chain,
 *      routing/404, root mapResponse chain, error, afterResponse.
 *
 * This suite runs one shared scenario matrix and asserts each observable
 * against ONE expected value where the arms must agree, and PINS the current
 * behavior (with a finding id) where they genuinely diverge. A pinned
 * divergence is a conscious tripwire, not an endorsement — if the behavior
 * changes, this test must be revisited.
 *
 * WS is covered in http-vs-ws.test.ts. Production masking (needs NODE_ENV) is
 * covered by a subprocess in production-masking.test.ts. This suite runs
 * WITHOUT NODE_ENV.
 */

import { describe, it, expect } from 'bun:test'
import { Elysia, t, status } from '../../src'

const PROBLEM_JSON = 'application/problem+json'

describe('HTTP lifecycle parity (per-route JIT + root dispatcher)', () => {
	// ------------------------------------------------------------------
	// Hook order + context-mutation visibility (per-route JIT arm).
	// This is the golden order every per-route stage must observe. WS is
	// asserted against this same order in http-vs-ws.test.ts.
	// ------------------------------------------------------------------
	it('per-route hook order: transform -> beforeHandle -> handler -> afterHandle -> afterResponse', async () => {
		const order: string[] = []

		const app = new Elysia().get(
			'/order',
			{
				transform() {
					order.push('transform')
				},
				beforeHandle() {
					order.push('beforeHandle')
				},
				afterHandle() {
					order.push('afterHandle')
				},
				afterResponse() {
					order.push('afterResponse')
				}
			},
			() => {
				order.push('handler')
				return 'ok'
			}
		)

		const res = await app.handle(new Request('http://localhost/order'))
		const body = await res.text()

		// afterResponse is scheduled on a microtask; let it flush
		await new Promise((r) => setTimeout(r, 20))

		expect(body).toBe('ok')
		expect(order).toEqual([
			'transform',
			'beforeHandle',
			'handler',
			'afterHandle',
			'afterResponse'
		])
	})

	it('context mutation from derive/transform is visible in the handler', async () => {
		const app = new Elysia()
			.derive(() => ({ fromDerive: 'D' }))
			.get(
				'/ctx',
				{
					transform(ctx: any) {
						ctx.fromTransform = 'T'
					}
				},
				(ctx: any) => `${ctx.fromDerive}:${ctx.fromTransform}`
			)

		const res = await app.handle(new Request('http://localhost/ctx'))
		expect(await res.text()).toBe('D:T')
	})

	// ------------------------------------------------------------------
	// afterHandle return override — HTTP per-route arm replaces the response.
	// (WS discards it: pinned in http-vs-ws.test.ts.)
	// ------------------------------------------------------------------
	it('afterHandle return value replaces the handler response (HTTP)', async () => {
		const app = new Elysia().get(
			'/after',
			{
				afterHandle: () => 'AFTER-WINS'
			},
			() => 'handler-body'
		)

		const res = await app.handle(new Request('http://localhost/after'))
		expect(await res.text()).toBe('AFTER-WINS')
	})

	// ------------------------------------------------------------------
	// mapResponse transform on the per-route arm.
	// ------------------------------------------------------------------
	it('mapResponse transforms a per-route handler response', async () => {
		const app = new Elysia()
			.mapResponse(({ responseValue }: any) => {
				if (typeof responseValue === 'string')
					return new Response(`WRAP:${responseValue}`, {
						headers: { 'x-mapped': '1' }
					})
			})
			.get('/hello', () => 'world')

		const res = await app.handle(new Request('http://localhost/hello'))
		expect(await res.text()).toBe('WRAP:world')
		expect(res.headers.get('x-mapped')).toBe('1')
	})

	// ------------------------------------------------------------------
	// Response schema Encode (codec) on the per-route arm.
	// The JIT arm runs `_vr.EncodeFrom(_r,'response')` (jit.ts:926/931).
	// WS skips this: pinned ws-3 in http-vs-ws.test.ts.
	// ------------------------------------------------------------------
	it('response codec is Encoded on the per-route arm', async () => {
		const Coded = t
			.Codec(t.String())
			.Decode((s: string) => Number(s.replace(/^n:/, '')))
			.Encode((n: number) => `n:${n}`)

		const app = new Elysia().get(
			'/c',
			{ response: t.Object({ v: Coded }) },
			() => ({ v: 42 })
		)

		const res = await app.handle(new Request('http://localhost/c'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('{"v":"n:42"}')
	})

	// ------------------------------------------------------------------
	// Returned vs thrown status() — must be identical on the HTTP arm.
	// ------------------------------------------------------------------
	it('status() returned and thrown produce identical responses', async () => {
		const app = new Elysia()
			.get('/return', () => status(418, 'teapot'))
			.get('/throw', () => {
				throw status(418, 'teapot')
			})

		const ret = await app.handle(new Request('http://localhost/return'))
		const thr = await app.handle(new Request('http://localhost/throw'))

		const expected = { status: 418, body: 'teapot' }
		expect({ status: ret.status, body: await ret.text() }).toEqual(expected)
		expect({ status: thr.status, body: await thr.text() }).toEqual(expected)
	})

	// ------------------------------------------------------------------
	// Error hook — RFC 9457 problem+json (NOT the old constructor.name shape).
	// ------------------------------------------------------------------
	it('uncaught error becomes RFC 9457 problem+json 500', async () => {
		const app = new Elysia().get('/boom', () => {
			throw new Error('boom')
		})

		const res = await app.handle(new Request('http://localhost/boom'))
		expect(res.status).toBe(500)
		expect(res.headers.get('content-type')).toBe(PROBLEM_JSON)

		const body = JSON.parse(await res.text())
		expect(body).toMatchObject({
			title: 'Internal Server Error',
			status: 500,
			detail: 'boom'
		})
	})

	it('.error() hook can recover a thrown error into a 200 response', async () => {
		const app = new Elysia()
			.error(({ error }: any) => {
				if ((error as Error).message === 'recoverable')
					return new Response('handled', { status: 200 })
				return undefined
			})
			.get('/handled', () => {
				throw new Error('recoverable')
			})
			.get('/unhandled', () => {
				throw new Error('other')
			})

		// Recovered by the error hook
		const handled = await app.handle(
			new Request('http://localhost/handled')
		)
		expect(handled.status).toBe(200)
		expect(await handled.text()).toBe('handled')

		// Not recovered -> still 500 problem+json
		const unhandled = await app.handle(
			new Request('http://localhost/unhandled')
		)
		expect(unhandled.status).toBe(500)
	})

	// ------------------------------------------------------------------
	// Validation failure — 422 problem+json shape.
	// ------------------------------------------------------------------
	it('validation failure is a 422 problem+json with on/property', async () => {
		const app = new Elysia().get(
			'/v',
			{ query: t.Object({ n: t.Numeric() }) },
			({ query }) => query.n
		)

		const res = await app.handle(new Request('http://localhost/v'))
		expect(res.status).toBe(422)
		expect(res.headers.get('content-type')).toBe(PROBLEM_JSON)

		const body = JSON.parse(await res.text())
		expect(body).toMatchObject({
			type: 'validation',
			title: 'Validation Error',
			status: 422,
			on: 'query'
		})
	})

	// ==================================================================
	// Root-dispatcher arm (src/handler/fetch.ts) — behaviors implemented
	// in fetch.ts itself, not delegated to the per-route JIT handler.
	// ==================================================================

	it('root 404 for an unmatched route is RFC 9457 problem+json', async () => {
		const app = new Elysia().get('/exists', () => 'ok')

		const res = await app.handle(new Request('http://localhost/nope'))
		expect(res.status).toBe(404)
		expect(res.headers.get('content-type')).toBe(PROBLEM_JSON)
		expect(JSON.parse(await res.text())).toMatchObject({
			type: 'not-found',
			title: 'Not Found',
			status: 404
		})
	})

	it('dynamic-route dispatch (router.find) runs the same per-route lifecycle', async () => {
		const order: string[] = []
		const app = new Elysia().get(
			'/user/:id',
			{
				beforeHandle() {
					order.push('beforeHandle')
				},
				afterHandle() {
					order.push('afterHandle')
				}
			},
			({ params }) => `id:${params.id}`
		)

		const res = await app.handle(new Request('http://localhost/user/42'))
		expect(await res.text()).toBe('id:42')
		// Same stage order as the static route — dispatch arm is transparent
		expect(order).toEqual(['beforeHandle', 'afterHandle'])
	})

	it('.request() early-return short-circuits before routing', async () => {
		const seen: string[] = []
		const app = new Elysia()
			.request(({ request }) => {
				seen.push('request')
				if (new URL(request.url).pathname === '/gate') return 'GATED'
			})
			.get('/gate', () => {
				seen.push('handler')
				return 'handler-body'
			})

		const res = await app.handle(new Request('http://localhost/gate'))
		expect(await res.text()).toBe('GATED')
		// handler never ran — the root arm returned before findRoute
		expect(seen).toEqual(['request'])
	})

	// ------------------------------------------------------------------
	// A9 / C14 (plan.md 2026-07-12): `.request()` early-return DOES run mapResponse.
	//
	// Prior to A9 the `.request()` early-return called `mapResponse(result, set)`
	// without the `context` arg (fetch.ts ~line 418/498/556), so the wrapper's
	// `if (!context) return baseMapResponse(...)` guard skipped the hook chain.
	// A9 fixes this by passing `context` in all three short-circuit paths.
	//
	// This replaces the previous "INTENDED (maintainer 2026-07-06)" test that
	// asserted the opposite contract. The plan (2026-07-12, post Sol peer review)
	// supersedes that earlier decision: every terminal now goes through the
	// mapping tail exactly once. The conflict is surfaced here per Rule 7.
	// ------------------------------------------------------------------
	it('A9/C14: .request() early-return runs mapResponse hooks', async () => {
		const ran: string[] = []
		const app = new Elysia()
			// `.request()` context exposes `path` at runtime; the PreContext type
			// doesn't surface it, so widen to `any` to assert against the real API.
			.request((ctx: any) => {
				if (ctx.path === '/gate') return 'GATED'
			})
			.mapResponse(({ responseValue }: any) => {
				ran.push('mapResponse')
				if (typeof responseValue === 'string')
					return new Response(`WRAP:${responseValue}`)
			})
			.get('/passthrough', () => 'passthrough')

		// route return -> mapResponse runs
		const routed = await app.handle(
			new Request('http://localhost/passthrough')
		)
		expect(await routed.text()).toBe('WRAP:passthrough')
		expect(ran).toContain('mapResponse')

		ran.length = 0

		// .request() early-return -> mapResponse hook ALSO runs (A9 fix)
		const gated = await app.handle(new Request('http://localhost/gate'))
		expect(await gated.text()).toBe('WRAP:GATED')
		expect(ran).toContain('mapResponse')
	})
})
