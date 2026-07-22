import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { defaultHeaders } from '../../src/adapter/default-headers'
import { JITProbe } from '../../src/compile/jit-probe'
import {
	RouteEffect,
	type RouteCompileState,
	type RouteDescriptor
} from '../../src/compile/handler/descriptor'
import {
	planRouteProgram,
	useLegacyRouteProgramLane,
	type RouteProgramFallbackReason
} from '../../src/compile/handler/program-plan'
import {
	bindRouteProgram,
	isRouteProgram,
	type RouteProgram
} from '../../src/compile/handler/program'

const bodyPlan = {
	enabled: false,
	mode: 'none',
	builtin: null,
	parserCount: 0,
	custom: false,
	fallback: false,
	mediaKind: 0,
	presence: 'none'
} as const

const descriptor: RouteDescriptor = {
	method: 'GET',
	path: '/',
	handlerKind: 'function',
	isStaticResponse: false,
	async: false,
	bodyPlan,
	responseMode: 'compact',
	contextMode: 'compact',
	headerKeys: [],
	effectMask: 0,
	hasBeforeHandle: false,
	hasAfterHandle: false,
	hasMapResponse: false,
	hasAfterResponse: false,
	hasErrorHook: false,
	hasResponseValidator: false,
	hasTrace: false,
	traceCount: 0,
	hasLifecycleHook: false,
	hasBody: false,
	bodyValiIsAsync: false,
	headersValiIsAsync: false,
	paramsValiIsAsync: false,
	queryValiIsAsync: false,
	cookieValiIsAsync: false,
	responseValiAsync: false,
	hasCookieSign: false,
	syncCookieSign: false,
	asyncCookieSign: false,
	lazyCookieVerify: false,
	handlerIsAsync: false,
	callHandlerSyncOnAsync: false,
	syncErrorHook: false,
	syncAfterResponse: false
}

const state = (
	descriptorOverride: Partial<RouteDescriptor> = {},
	stateOverride: Partial<RouteCompileState> = {}
): RouteCompileState => ({
	descriptor: { ...descriptor, ...descriptorOverride },
	bodyParserHooks: undefined,
	vali: undefined,
	cookieConfig: undefined,
	beforeHandlePrefix: undefined,
	traceHandlers: undefined,
	tracePhases: new Set(),
	hasAnyPhase: false,
	traceHandleOn: false,
	defaultResponseState: undefined,
	...stateOverride
})

const fallback = (
	value: ReturnType<typeof planRouteProgram>
): RouteProgramFallbackReason => {
	expect('fallback' in value).toBe(true)
	return (value as { fallback: RouteProgramFallbackReason }).fallback
}

describe('route program planning', () => {
	it('keeps the D2 oracle on the generated-source lowerer per app', async () => {
		const oracle = {}
		useLegacyRouteProgramLane(oracle)

		expect(
			fallback(planRouteProgram(state(), () => 'ok', false, oracle))
		).toBe('legacy-lane')
		expect(planRouteProgram(state(), () => 'ok', false, {})).toEqual({
			program: [1, 0]
		})

		const legacyApp = new Elysia().get('/', () => 'legacy')
		useLegacyRouteProgramLane(legacyApp)
		JITProbe.begin()
		await legacyApp.handle(new Request('http://localhost/'))
		expect(JITProbe.end().reasons).toContain('handler:new-function')

		const canonicalApp = new Elysia().get('/', () => 'canonical')
		JITProbe.begin()
		await canonicalApp.handle(new Request('http://localhost/'))
		expect(JITProbe.end().reasons).not.toContain('handler:new-function')
	})

	it('encodes the four response sinks', () => {
		const handler = () => 'ok'
		const defaults = { headers: { 'x-default': 'yes' } }

		expect(planRouteProgram(state(), handler, false)).toEqual({
			program: [1, 0]
		})
		expect(
			planRouteProgram(
				state({ responseMode: 'set', contextMode: 'set' }),
				handler,
				false
			)
		).toEqual({ program: [1, 1] })
		expect(
			planRouteProgram(
				state(
					{ responseMode: 'default-headers' },
					{ defaultResponseState: defaults }
				),
				handler,
				false
			)
		).toEqual({ program: [1, 2] })
		expect(
			planRouteProgram(
				state({
					responseMode: 'set-with-default-headers',
					contextMode: 'set',
					effectMask: RouteEffect.SetHeaders
				}),
				handler,
				false
			)
		).toEqual({ program: [1, 3] })
	})

	it('rejects every unsupported execution class', () => {
		const handler = () => 'ok'
		function* generator() {
			yield 'ok'
		}

		expect(fallback(planRouteProgram(state(), handler, true))).toBe(true)
		expect(fallback(planRouteProgram(state(), 'ok', false))).toBe(true)
		expect(
			fallback(
				planRouteProgram(
					state({ async: true, handlerIsAsync: true }),
					async () => 'ok',
					false
				)
			)
		).toBe(true)
		expect(fallback(planRouteProgram(state(), generator, false))).toBe(true)
		expect(
			fallback(
				planRouteProgram(
					state(
						{},
						{ vali: { params: {} } as RouteCompileState['vali'] }
					),
					handler,
					false
				)
			)
		).toBe(true)
		expect(
			fallback(
				planRouteProgram(
					state({
						bodyPlan: { ...bodyPlan, enabled: true },
						hasBody: true
					}),
					handler,
					false
				)
			)
		).toBe(true)
		expect(
			fallback(
				planRouteProgram(
					state({}, { cookieConfig: {} as any }),
					handler,
					false
				)
			)
		).toBe(true)
		expect(
			fallback(
				planRouteProgram(
					state({ hasLifecycleHook: true }),
					handler,
					false
				)
			)
		).toBe(true)
		expect(
			fallback(
				planRouteProgram(state({ hasTrace: true }), handler, false)
			)
		).toBe(true)
		expect(
			fallback(
				planRouteProgram(
					state({ hasResponseValidator: true }),
					handler,
					false
				)
			)
		).toBe(true)

		for (const effect of [
			RouteEffect.Query,
			RouteEffect.Headers,
			RouteEffect.Route
		])
			expect(
				fallback(
					planRouteProgram(
						state({ effectMask: effect }),
						handler,
						false
					)
				)
			).toBe(true)
	})

	it('keeps unsupported compatibility routes on the legacy inline fallback', async () => {
		const apps = [
			new Elysia({
				experimental: { cancellation: 'compat' }
			}).get('/', () => 'compat'),
			new Elysia().get(
				'/',
				{ detail: { description: 'metadata only' } },
				() => 'metadata'
			)
		]

		for (const app of apps) {
			JITProbe.begin()
			const response = await app.handle(new Request('http://localhost/'))
			const probe = JITProbe.end()

			expect(await response.text()).toMatch(/compat|metadata/)
			expect(probe.reasons).not.toContain('handler:new-function')
		}
	})
})

describe('route program binding', () => {
	const request = new Request('http://localhost/')
	const response = {
		compact: (value: unknown, seenRequest: Request, owned: boolean) => ({
			value,
			seenRequest,
			owned
		}),
		map: (
			value: unknown,
			set: unknown,
			seenRequest: Request,
			owned: boolean
		) => ({ value, set, seenRequest, owned })
	} as any
	const context = () => ({
		request,
		set: { headers: Object.create(null) }
	})

	it('binds compact, set, default, and materialized-default sinks', () => {
		const compactContext = context()
		expect(
			bindRouteProgram(
				[1, 0],
				() => 'compact',
				response
			)(compactContext as any)
		).toEqual({ value: 'compact', seenRequest: request, owned: true })

		const setContext = context()
		expect(
			bindRouteProgram([1, 1], () => 'set', response)(setContext as any)
		).toEqual({
			value: 'set',
			set: setContext.set,
			seenRequest: request,
			owned: true
		})

		const defaults = { headers: { 'x-default': 'yes' } }
		expect(
			bindRouteProgram(
				[1, 2],
				() => 'defaults',
				response,
				defaults
			)(context() as any)
		).toEqual({
			value: 'defaults',
			set: defaults,
			seenRequest: request,
			owned: true
		})

		const sharedHeaders = { 'x-default': 'yes' }
		Object.defineProperty(sharedHeaders, defaultHeaders, {
			value: sharedHeaders
		})
		const materializedContext = {
			request,
			set: { headers: sharedHeaders }
		}
		const bound = bindRouteProgram(
			[1, 3],
			(c: any) => {
				expect(c.set.headers).not.toBe(sharedHeaders)
				c.set.headers['x-route'] = 'yes'
				return 'materialized'
			},
			response
		)

		expect(bound(materializedContext as any)).toMatchObject({
			value: 'materialized',
			set: {
				headers: { 'x-default': 'yes', 'x-route': 'yes' }
			},
			owned: true
		})
		expect(sharedHeaders).toEqual({ 'x-default': 'yes' })
	})

	it('throws returned errors and forwards native Promise errors', async () => {
		const syncError = new Error('sync')
		const asyncError = new Error('async')

		expect(() =>
			bindRouteProgram(
				[1, 0],
				() => syncError,
				response
			)(context() as any)
		).toThrow(syncError)
		await expect(
			bindRouteProgram(
				[1, 0],
				() => Promise.resolve(asyncError),
				response
			)(context() as any)
		).rejects.toBe(asyncError)
	})

	it('rejects corrupt programs, missing state, and non-function handlers', () => {
		expect(isRouteProgram([1, 0])).toBe(true)
		expect(isRouteProgram([2, 0])).toBe(false)
		expect(() =>
			bindRouteProgram(
				[2, 0] as unknown as RouteProgram,
				() => 'ok',
				response
			)
		).toThrow(/route program/i)
		expect(() =>
			bindRouteProgram(
				[1, 4] as unknown as RouteProgram,
				() => 'ok',
				response
			)
		).toThrow(/route program/i)
		expect(() => bindRouteProgram([1, 2], () => 'ok', response)).toThrow(
			/response state/i
		)
		expect(() =>
			bindRouteProgram([1, 0], null as unknown as Function, response)
		).toThrow(/function handler/i)
	})
})
