import { afterEach, describe, expect, it } from 'bun:test'

import {
	Capture,
	createAotFingerprint
} from '../../src/compile/aot'
import { createAppPlan } from '../../src/compile/app-plan'
import {
	abortCapture,
	beginValidatorCapture,
	endValidatorCapture,
	endWSCapture
} from '../../src/compile/aot-capture'
import { emitModule } from '../../src/plugin/aot/source'
import type { WSRoutePlan } from '../../src/ws/runtime'

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

		const source = emitModule([], routes, createAotFingerprint(), {
			register: false,
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
		expect(source).toContain('const _wr0 = { a: _wa0, f: _wf0 }')
		expect(source).not.toContain('export const wsRoutes')
		expect(source).not.toContain('handlers')
		expect(source).not.toContain('/fallback')
	})

	it('attaches AppPlan identity while preserving raw WS hook roles', () => {
		const message = () => undefined
		const appPlan = createAppPlan({
			application: {
				fetch: {},
				lifecycle: {}
			},
			adapter: { target: 'bun' },
			httpRoutes: [],
			wsRoutes: [
				{
					path: '/chat',
					plan: {} as WSRoutePlan,
					version: 1,
					content: { flags: 1 },
					bindings: [{ role: 'wsMessage', value: message }]
				}
			]
		})
		const source = emitModule(
			[],
			[
				{
					path: '/chat',
					roles: ['message'],
					source: 'buildFrozenWSRoute({sync:1})'
				}
			],
			createAotFingerprint(),
			{ appPlan, register: true }
		)

		expect(source).toContain('roles: _wa0, image: _wr0')
		expect(source).toContain(
			'export const appPlanWSRoutes = {"/chat":_awr0,}'
		)
		expect(source).toContain('export const appPlanPayload = {"format":')
		expect(source).toContain(
			'appPlan: { payload: appPlanPayload, validators: appPlanValidators, wsRoutes: appPlanWSRoutes }'
		)
		expect(source).toContain('"role":"wsMessage"')
	})

	it('keeps the HTTP-only manifest byte shape free of WS image fields', () => {
		const source = emitModule([], [], createAotFingerprint(), {
			register: false
		})

		expect(source).not.toContain('wsRoutes')
		expect(source).not.toContain('buildFrozenWSRoute')
		expect(source).not.toContain('elysia/ws/runtime')
	})

	it('imports the default runtime for a non-registering WS module', () => {
		const source = emitModule(
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
	})
})
