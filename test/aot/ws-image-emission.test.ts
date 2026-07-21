import { afterEach, describe, expect, it } from 'bun:test'

import {
	Capture,
	createAotFingerprint
} from '../../src/compile/aot'
import {
	abortCapture,
	beginValidatorCapture,
	endHandlerCapture,
	endValidatorCapture,
	endWSCapture
} from '../../src/compile/aot-capture'
import { planFromReport } from '../../src/plugin/aot/core'
import { emitModule } from '../../src/plugin/aot/source'

afterEach(() => {
	abortCapture()
	delete process.env.ELYSIA_AOT_BUILD
})

describe('AOT WebSocket image emission', () => {
	it('emits supported routes with their exact binding slots', () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		beginValidatorCapture()

		Capture.ws({ path: '/chat', reason: 'first candidate rejected' })
		Capture.ws({
			path: '/chat',
			roles: ['message', 'message', 'open'],
			source: 'buildFrozenWSRoute({sync:1})'
		})
		Capture.ws({ path: '/fallback', reason: 'computed callback access' })

		const routes = endWSCapture()
		endValidatorCapture()
		endHandlerCapture()

		const source = emitModule([], [], routes, createAotFingerprint(), {
			register: true,
			wsRuntimeFrom: 'custom/ws-runtime'
		})

		expect(source).toContain(
			'import { buildFrozenWSRoute } from "custom/ws-runtime"'
		)
		expect(source).toContain(
			'const _wa0 = ["message","message","open"]'
		)
		expect(source).toContain(
			'const _wf0 = buildFrozenWSRoute({sync:1})'
		)
		expect(source).toContain('export const wsRoutes = {"/chat":_wr0,}')
		expect(source).toContain('handlers, wsRoutes')
		expect(source).not.toContain('/fallback')
	})

	it('keeps the HTTP-only manifest byte shape free of WS image fields', () => {
		const source = emitModule([], [], [], createAotFingerprint(), {
			register: true
		})

		expect(source).not.toContain('wsRoutes')
		expect(source).not.toContain('buildFrozenWSRoute')
		expect(source).not.toContain('elysia/ws/runtime')
	})

	it('imports the default runtime for a non-registering WS module', () => {
		const source = emitModule(
			[],
			[],
			[
				{
					path: '/chat',
					roles: [],
					source: 'buildFrozenWSRoute({sync:1})'
				}
			],
			createAotFingerprint()
		)

		expect(source).toContain(
			'import { buildFrozenWSRoute } from "elysia/ws/runtime"'
		)
	})

	it('keeps only the last WS capture for a duplicate path', () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		beginValidatorCapture()

		Capture.beginRoute('WS', '/chat')
		Capture.ws({
			path: '/chat',
			roles: ['message'],
			source: 'buildFrozenWSRoute({first:1})'
		})
		Capture.beginRoute('WS', '/chat')
		Capture.ws({ path: '/chat', reason: 'last route is unsupported' })

		expect(endWSCapture()).toEqual([
			{ path: '/chat', reason: 'last route is unsupported' }
		])
		endValidatorCapture()
		endHandlerCapture()
	})
})

describe('AOT WebSocket strip planning', () => {
	const report = {
		stubbable: true,
		jit: true,
		reasons: []
	} as const

	const plan = (hasWS: boolean, covered: boolean) =>
		planFromReport(
			'auto',
			report,
			hasWS,
			false,
			new Set(),
			true,
			false,
			false,
			true,
			covered
		).plan

	it('separates no-WS stripping from covered WS-JIT stripping', () => {
		expect(plan(false, true)).toMatchObject({ ws: true, wsJit: false })
		expect(plan(true, true)).toMatchObject({ ws: false, wsJit: true })
		expect(plan(true, false)).toMatchObject({ ws: false, wsJit: false })
	})
})
