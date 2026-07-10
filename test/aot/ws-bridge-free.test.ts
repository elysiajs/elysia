import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot'
import { RouteValidator } from '../../src/validator/route'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import { generateCompiledArtifacts } from '../../src/plugin/aot/core'

import { materialise } from './_manifest'

/**
 * WS bridge-free reconstruction.
 *
 * WS routes build their validators through the same `RouteValidator` with
 * `aot: { method: 'WS', path }`, so their slots are captured into the manifest
 * like HTTP slots. Under a sealed strip, `createWSRoute` catches the severed-
 * bridge throw and reconstructs via `buildFrozenRouteValidator` — these pin
 * that the frozen WS validators match the wired ones, and that WS no longer
 * forces the plugin's bridge mode to `off`.
 */

const PATH = '/chat'

const WS_HOOK = () => ({
	body: t.Object({ message: t.String(), n: t.Optional(t.Date()) }),
	query: t.Object({ room: t.Number() }),
	response: t.Object({ echo: t.String() })
})

function freezeWS(hook: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
	beginValidatorCapture()

	const app = new Elysia().ws(PATH, {
		...hook,
		message(ws: any, body: any) {
			ws.send({ echo: body.message })
		}
	})
	;(app as any).compile()

	const captured = endValidatorCapture()
	endHandlerCapture()
	delete process.env.ELYSIA_AOT_BUILD

	Compiled.clear()
	Validator.clear()
	Compiled.validators = materialise(captured)

	return captured.filter((c) => c.method === 'WS')
}

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

describe('WS bridge-free frozen validator', () => {
	it('captures WS slots with bridgeFree markers', () => {
		const captured = freezeWS(WS_HOOK())

		const slots = captured.map((c) => c.slot).sort()
		expect(slots).toEqual(['body', 'query', 'response:200'])

		for (const c of captured) expect(c.bridgeFree).toBe(true)
	})

	it('reconstructs the WS route validator bridge-free with wired parity', () => {
		const hook = WS_HOOK()
		freezeWS(hook)

		const wired = new RouteValidator(hook as any, {
			aot: { method: 'WS', path: PATH }
		} as any)
		const frozen = buildFrozenRouteValidator(
			hook as any,
			new Elysia() as any,
			'WS',
			PATH
		)

		expect(frozen).toBeDefined()

		// body: message dispatch uses `hasCodec ? From : Check`
		expect((frozen!.body as any).hasCodec).toBe(
			(wired.body as any).hasCodec
		)

		const bodies = [
			{ message: 'hi' },
			{ message: 'hi', n: '2024-01-02T03:04:05.000Z' },
			{ message: 1 },
			{},
			{ message: 'hi', junk: true }
		]
		for (const b of bodies) {
			const w = (() => {
				try {
					return {
						ok: true,
						v: (wired.body as any).From(structuredClone(b), 'body')
					}
				} catch (e: any) {
					return { ok: false, s: e?.status }
				}
			})()
			const f = (() => {
				try {
					return {
						ok: true,
						v: (frozen!.body as any).From(
							structuredClone(b),
							'body'
						)
					}
				} catch (e: any) {
					return { ok: false, s: e?.status }
				}
			})()

			expect(f.ok, `body parity for ${JSON.stringify(b)}`).toBe(w.ok)
			if (w.ok)
				expect(JSON.stringify(f.v)).toBe(JSON.stringify(w.v))
			else expect(f.s).toBe(w.s)
		}

		// query: upgrade validation (Numeric coercion via cp)
		const queries = [{ room: '7' }, { room: 7 }, { room: 'x' }, {}]
		for (const q of queries) {
			const w = (() => {
				try {
					return {
						ok: true,
						v: (wired.query as any).From(
							structuredClone(q),
							'query'
						)
					}
				} catch (e: any) {
					return { ok: false, s: e?.status }
				}
			})()
			const f = (() => {
				try {
					return {
						ok: true,
						v: (frozen!.query as any).From(
							structuredClone(q),
							'query'
						)
					}
				} catch (e: any) {
					return { ok: false, s: e?.status }
				}
			})()

			expect(f.ok, `query parity for ${JSON.stringify(q)}`).toBe(w.ok)
			if (w.ok)
				expect(JSON.stringify(f.v)).toBe(JSON.stringify(w.v))
		}

		// response: WS send validation only uses `Check` (ws/context.ts)
		const wiredRes = (wired.response as any)[200]
		const frozenRes = (frozen!.response as any)[200]
		expect(frozenRes).toBeDefined()
		for (const r of [{ echo: 'x' }, { echo: 1 }, {}])
			expect(
				frozenRes.Check(r),
				`response Check parity for ${JSON.stringify(r)}`
			).toBe(wiredRes.Check(r))
	})

	// Security regression: under a sealed/AOT build the WS body validator is a
	// FrozenSlotValidator, which exposes strip ONLY via From/EncodeFrom (private
	// #clean) and has NO public `.Clean`. validateMessageBody must therefore use
	// EncodeFrom, not `.Clean` — otherwise undeclared attacker fields leak on
	// exactly the sealed deployments (bundled builds / Cloudflare Workers) while
	// sealed HTTP still strips, an HTTP/WS mass-assignment asymmetry.
	it('sealed/frozen WS body strips undeclared props via EncodeFrom (parity with wired)', () => {
		const hook = { body: t.Object({ a: t.String() }) }
		freezeWS(hook)

		const wired = new RouteValidator(hook as any, {
			aot: { method: 'WS', path: PATH }
		} as any)
		const frozen = buildFrozenRouteValidator(
			hook as any,
			new Elysia() as any,
			'WS',
			PATH
		)
		expect(frozen).toBeDefined()

		// plain non-codec body → validateMessageBody dispatches through EncodeFrom
		expect((frozen!.body as any).hasCodec).toBe(false)
		// the reason EncodeFrom is required: no public Clean on the frozen validator
		expect((frozen!.body as any).Clean).toBeUndefined()

		const attacker = { a: 'hi', evil: 'INJECTED', nested: { x: 1 } }
		const wiredOut = (wired.body as any).EncodeFrom(
			structuredClone(attacker),
			'body'
		)
		const frozenOut = (frozen!.body as any).EncodeFrom(
			structuredClone(attacker),
			'body'
		)

		expect(wiredOut).toEqual({ a: 'hi' })
		expect(frozenOut).toEqual({ a: 'hi' })
	})

	it('WS-only app with schemas seals (mode A: compat stubbed, no reroute)', async () => {
		const { stub } = await generateCompiledArtifacts(
			'test/aot/fixtures/mode-ws-app.ts'
		)

		expect(stub.ws).toBe(false) // WS runtime module retained
		expect(stub.compat).toBe(true) // bridge severed
		expect(stub.bridge).toBe(false) // mode A, not the wired reroute
	})
})
