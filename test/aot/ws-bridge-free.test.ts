import { describe, it, expect, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled, type ProgramId } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import { RouteValidator } from '../../src/validator/route'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import { generateCompiledArtifacts } from '../../src/plugin/aot/core'

import { claimManifest, materialise } from './_manifest'

/** WebSocket validators reconstruct from the manifest without a TypeBox bridge. */

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
	claimed = claimManifest({ validators: materialise(captured) })

	return captured.filter((c) => c.method === 'WS')
}

// program claimed by the latest `freezeWS()`
let claimed: { ['~programId']: ProgramId }

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

describe('frozen WebSocket validator reconstruction', () => {
	it('captures each WebSocket schema slot as bridge-free', () => {
		const captured = freezeWS(WS_HOOK())

		const slots = captured.map((c) => c.slot).sort()
		expect(slots).toEqual(['body', 'query', 'response:200'])

		for (const c of captured) expect(c.bridgeFree).toBe(true)
	})

	it('matches live WebSocket validation without a TypeBox bridge', () => {
		const hook = WS_HOOK()
		freezeWS(hook)

		const wired = new RouteValidator(
			hook as any,
			{
				aot: { method: 'WS', path: PATH },
				app: claimed
			} as any
		)
		const frozen = buildFrozenRouteValidator(
			hook as any,
			claimed as any,
			'WS',
			PATH
		)

		expect(frozen).toBeDefined()

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
			if (w.ok) expect(JSON.stringify(f.v)).toBe(JSON.stringify(w.v))
			else expect(f.s).toBe(w.s)
		}

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
			if (w.ok) expect(JSON.stringify(f.v)).toBe(JSON.stringify(w.v))
		}

		const wiredRes = (wired.response as any)[200]
		const frozenRes = (frozen!.response as any)[200]
		expect(frozenRes).toBeDefined()
		for (const r of [{ echo: 'x' }, { echo: 1 }, {}])
			expect(
				frozenRes.Check(r),
				`response Check parity for ${JSON.stringify(r)}`
			).toBe(wiredRes.Check(r))
	})

	it('strips undeclared body properties without a public Clean method', () => {
		const hook = { body: t.Object({ a: t.String() }) }
		freezeWS(hook)

		const wired = new RouteValidator(
			hook as any,
			{
				aot: { method: 'WS', path: PATH },
				app: claimed
			} as any
		)
		const frozen = buildFrozenRouteValidator(
			hook as any,
			claimed as any,
			'WS',
			PATH
		)
		expect(frozen).toBeDefined()

		expect((frozen!.body as any).hasCodec).toBe(false)
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

	it('seals a schema-only WebSocket app without rerouting the bridge', async () => {
		const { stub } = await generateCompiledArtifacts(
			'test/aot/fixtures/mode-ws-app.ts'
		)

		expect(stub.ws).toBe(false)
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(false)
	})
})
