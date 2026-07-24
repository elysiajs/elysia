import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
// importing `aot-capture` also installs the build-only capture impl (side effect)
import {
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import { materialise, registerManifest } from '../aot/_manifest'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

// Frozen WebSocket builds capture and reuse body, query, and response validators.

beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1'
	// Shared capture state may contain validators from another AOT test.
	endValidatorCapture()
	endHandlerCapture()
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

const build = () =>
	new Elysia().use(websocket()).ws('/ws', {
		body: t.Object({ n: t.Number() }),
		query: t.Object({ token: t.String() }),
		response: t.Object({ ok: t.Boolean() }),
		message() {}
	})

// Echo decoded types so frozen and JIT validators can be compared.
const buildCodec = () =>
	new Elysia().use(websocket()).ws('/ws', {
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

// `.use(websocket()).ws()` returns AddWSRoute, so builders use the concrete value through `any`.
const captureManifest = (builder: () => any) => {
	process.env.ELYSIA_AOT_BUILD = '1'
	endValidatorCapture()
	endHandlerCapture()
	;(builder() as any).compile()
	const captured = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	return captured
}

const sendBody = async (app: any, payload: string): Promise<string> => {
	const ws = newWebsocket(app.server!)
	await wsOpen(ws)
	const message = wsMessage(ws)
	ws.send(payload)
	const { data } = await message
	await wsClosed(ws)
	return data as string
}

describe('AOT WebSocket schemas', () => {
	it('captures body, query, and response validators for WebSocket routes', () => {
		;(build() as any).compile()
		const captured = endValidatorCapture()

		const ws = captured.filter((v) => v.method === 'WS' && v.path === '/ws')
		const slots = ws.map((v) => String(v.slot))

		expect(ws.length).toBeGreaterThan(0)
		expect(slots).toContain('body')
		expect(slots).toContain('query')
		expect(slots.some((s) => s.startsWith('response'))).toBe(true)
	})

	it('reuses captured validators instead of recompiling them', () => {
		const captured = captureManifest(build)

		Validator.clear()
		// Register the frozen manifest as a generated module would; the next
		// build claims it through its own `~programId` (program lane).
		registerManifest({ validators: materialise(captured) })

		// A successful build alone cannot distinguish reuse from recompilation.
		const original = Compiled.getValidator
		const hits: string[] = []
		;(Compiled as any).getValidator = (
			m: string,
			p: string,
			s: any,
			id?: any
		) => {
			const entry = original.call(Compiled, m, p, s, id)
			if (m === 'WS' && p === '/ws' && entry !== undefined)
				hits.push(String(s))
			return entry
		}
		let app: any
		try {
			app = build()
			app.compile()
		} finally {
			;(Compiled as any).getValidator = original
		}

		const id = app['~programId']
		expect(Compiled.hasValidator('WS', '/ws', 'body', id)).toBe(true)
		expect(Compiled.hasValidator('WS', '/ws', 'query', id)).toBe(true)
		expect(hits).toContain('body')
		expect(hits).toContain('query')
	})

	it('frozen and JIT routes validate and decode messages identically', async () => {
		const VALID = JSON.stringify({
			when: '2020-01-01T00:00:00.000Z',
			n: '42'
		})
		const INVALID = JSON.stringify({ when: 'not-a-date', n: 'abc' })

		const captured = captureManifest(buildCodec)
		Validator.clear()
		// Register the frozen manifest; `buildCodec()` below claims it.
		registerManifest({ validators: materialise(captured) })

		const frozenApp = buildCodec().listen(0)
		expect(
			Compiled.hasValidator(
				'WS',
				'/ws',
				'body',
				(frozenApp as any)['~programId']
			)
		).toBe(true)
		const frozenValid = await sendBody(frozenApp, VALID)
		const frozenInvalid = await sendBody(frozenApp, INVALID)
		frozenApp.stop()

		Compiled.clear()
		Validator.clear()
		const jitApp = buildCodec().listen(0)
		const jitValid = await sendBody(jitApp, VALID)
		const jitInvalid = await sendBody(jitApp, INVALID)
		jitApp.stop()

		expect(JSON.parse(frozenValid)).toEqual({
			whenIsDate: true,
			iso: '2020-01-01T00:00:00.000Z',
			n: 42,
			nType: 'number'
		})

		expect(JSON.parse(frozenValid)).toEqual(JSON.parse(jitValid))
		expect(frozenInvalid).toBe(jitInvalid)

		expect(frozenInvalid).not.toBe(frozenValid)
		expect(frozenInvalid.length).toBeGreaterThan(0)
	})
})
