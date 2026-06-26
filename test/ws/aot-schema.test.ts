import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot'
import { materialise } from '../aot/_manifest'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

/**
 * WS body/query/response validators freeze into the AOT validator manifest the
 * same way HTTP routes do — driven by the `aot: { method: 'WS', path }` option
 * in `buildWSRoute`. Before this, WS routes recompiled TypeBox at runtime even
 * inside a frozen build. `WS` matches the `~map` method key, so no collision
 * with HTTP methods.
 */

beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1' // capture mode
	// Drain capture leaked by sibling AOT tests (same env, validators only drained)
	endValidatorCapture()
	endHandlerCapture()
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

const build = () =>
	new Elysia().ws('/ws', {
		body: t.Object({ n: t.Number() }),
		query: t.Object({ token: t.String() }),
		response: t.Object({ ok: t.Boolean() }),
		message() {}
	})

// Codec body (Date + Numeric) — both arrive as strings on the wire and must be
// DECODED before the handler runs. Echoes typed tags so the behavioural diff can
// prove the reconstructed validator coerced exactly like the JIT one.
const buildCodec = () =>
	new Elysia().ws('/ws', {
		body: t.Object({ when: t.Date(), n: t.Numeric() }),
		message(ws, body: any) {
			ws.send(
				JSON.stringify({
					whenIsDate: body.when instanceof Date,
					iso:
						body.when instanceof Date
							? body.when.toISOString()
							: null,
					n: body.n,
					nType: typeof body.n
				})
			)
		}
	})

// Drain + capture a fresh build, then leave capture mode and return the manifest.
// `builder` is typed loosely — `.ws()` returns an `AddWSRoute`, not a bare Elysia.
const captureManifest = (builder: () => any) => {
	process.env.ELYSIA_AOT_BUILD = '1'
	endValidatorCapture()
	endHandlerCapture()
	;(builder() as any).compile()
	const captured = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	return captured
}

// Open a socket, send one frame, resolve the echoed message, close.
const sendBody = async (app: any, payload: string): Promise<string> => {
	const ws = newWebsocket(app.server!)
	await wsOpen(ws)
	const message = wsMessage(ws)
	ws.send(payload)
	const { data } = await message
	await wsClosed(ws)
	return data as string
}

describe('AOT WebSocket schema freeze', () => {
	it('captures WS body/query/response validators under the WS method', () => {
		;(build() as any).compile()
		const captured = endValidatorCapture()

		const ws = captured.filter((v) => v.method === 'WS' && v.path === '/ws')
		const slots = ws.map((v) => String(v.slot))

		// the whole point: WS validators were captured at all
		expect(ws.length).toBeGreaterThan(0)
		expect(slots).toContain('body')
		expect(slots).toContain('query')
		expect(slots.some((s) => s.startsWith('response'))).toBe(true)
	})

	it('runtime buildWSRoute consults the manifest (reconstruct, not recompile)', () => {
		const captured = captureManifest(build)

		Validator.clear()
		Compiled.validators = materialise(captured)
		expect(Compiled.hasValidator('WS', '/ws', 'body')).toBe(true)
		expect(Compiled.hasValidator('WS', '/ws', 'query')).toBe(true)

		// Spy the REAL reconstruct fetch (type/validator/index.ts -> Compiled.getValidator).
		// `.not.toThrow()` is too weak — a silent recompile would also pass — so prove
		// the frozen build actually pulled each WS slot OUT of the manifest.
		const original = Compiled.getValidator
		const hits: string[] = []
		;(Compiled as any).getValidator = (m: string, p: string, s: any) => {
			const entry = original.call(Compiled, m, p, s)
			if (m === 'WS' && p === '/ws' && entry !== undefined)
				hits.push(String(s))
			return entry
		}
		try {
			;(build() as any).compile()
		} finally {
			;(Compiled as any).getValidator = original
		}

		expect(hits).toContain('body')
		expect(hits).toContain('query')
	})

	it('frozen WS validates + coerces identically to JIT (behavioural diff)', async () => {
		const VALID = JSON.stringify({
			when: '2020-01-01T00:00:00.000Z',
			n: '42'
		})
		// both fields invalid: 'not-a-date' Date + non-numeric 'abc'
		const INVALID = JSON.stringify({ when: 'not-a-date', n: 'abc' })

		// ── frozen (AOT-reconstructed) ─────────────────────────────────────
		const captured = captureManifest(buildCodec)
		Validator.clear()
		Compiled.validators = materialise(captured)
		expect(Compiled.hasValidator('WS', '/ws', 'body')).toBe(true)

		const frozenApp = buildCodec().listen(0)
		const frozenValid = await sendBody(frozenApp, VALID)
		const frozenInvalid = await sendBody(frozenApp, INVALID)
		frozenApp.stop()

		// ── JIT reference (no manifest) ────────────────────────────────────
		Compiled.clear()
		Validator.clear()
		const jitApp = buildCodec().listen(0)
		const jitValid = await sendBody(jitApp, VALID)
		const jitInvalid = await sendBody(jitApp, INVALID)
		jitApp.stop()

		// coercion really happened on the frozen path (string -> Date/number)
		expect(JSON.parse(frozenValid)).toEqual({
			whenIsDate: true,
			iso: '2020-01-01T00:00:00.000Z',
			n: 42,
			nType: 'number'
		})

		// frozen === JIT for both valid decode and invalid rejection
		expect(JSON.parse(frozenValid)).toEqual(JSON.parse(jitValid))
		expect(frozenInvalid).toBe(jitInvalid)

		// invalid input was rejected, not silently echoed as the handler output
		expect(frozenInvalid).not.toBe(frozenValid)
		expect(frozenInvalid.length).toBeGreaterThan(0)
	})
})
