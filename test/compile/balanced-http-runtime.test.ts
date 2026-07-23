import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { WebStandardAdapter } from '../../src/adapter/web-standard'
import { createTraceHandles } from '../../src/trace'
import { compileCookieConfig } from '../../src/cookie/config'
import { createAppPlan } from '../../src/compile/app-plan'
import { detachValidatorCompiler } from '../../src/validator'
import { RouteValidator } from '../../src/validator/route'
import {
	RouteEffect,
	type RouteCompileState,
	type RouteDescriptor
} from '../../src/compile/handler/descriptor'
import {
	BalancedHttpUnsupportedError,
	balancedAdapterPlan,
	lowerBalancedHttpAppPlan,
	planBalancedHttpRoute,
	sealBalancedHttpRoutes
} from '../../src/compile/handler/balanced-program'
import { compileBalancedHttpRoute } from '../../src/compile/handler/runtime'

const bodyPlan: RouteDescriptor['bodyPlan'] = {
	enabled: false,
	mode: 'none',
	builtin: null,
	parserCount: 0,
	custom: false,
	fallback: false,
	mediaKind: 0,
	presence: 'none'
}

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
	descriptor: {
		...descriptor,
		...descriptorOverride,
		bodyPlan: descriptorOverride.bodyPlan ?? bodyPlan
	},
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

const options = (
	handler: unknown,
	stateValue = state(),
	hook: any = undefined,
	root = new Elysia()
) => ({
	method: stateValue.descriptor.method,
	path: stateValue.descriptor.path,
	handler,
	root: root as any,
	finalizeError: (_context: any, error: Error) =>
		new Response(`final:${error.message}`, { status: 500 }),
	hook,
	adapter: WebStandardAdapter,
	state: stateValue
})

const context = (
	request: Request,
	params: Record<string, string> = Object.create(null)
) =>
	({
		request,
		params,
		qi: request.url.indexOf('?'),
		set: { headers: Object.create(null) }
	}) as any

const responseShape = async (value: Response | Promise<Response>) => {
	const response = await value
	return {
		status: response.status,
		body: await response.text(),
		headers: [...response.headers].sort(([a], [b]) => a.localeCompare(b))
	}
}

const adapterPlan = balancedAdapterPlan(WebStandardAdapter)
const sealedValidators = (
	route: ConstructorParameters<typeof RouteValidator>[0]
) => {
	const owner = {}
	const validators = new RouteValidator(route, { app: owner })
	detachValidatorCompiler(owner)
	return validators
}
const appPlan = (...routes: any[]) =>
	createAppPlan({
		application: {
			fetch: {},
			lifecycle: {},
			bindings: adapterPlan.bindings
		},
		adapter: adapterPlan.adapter,
		httpRoutes: routes
	})

const compileFromAppPlan = (routeOptions: ReturnType<typeof options>) => {
	const result = planBalancedHttpRoute(routeOptions)
	if (!result.supported)
		throw new BalancedHttpUnsupportedError(
			result.method,
			result.path,
			result.reason
		)
	const routeAdapterPlan = balancedAdapterPlan(routeOptions.adapter)
	const application = createAppPlan({
		application: {
			fetch: {},
			lifecycle: {},
			bindings: [
				{ role: 'routeErrorFinalizer', value: routeOptions.finalizeError },
				...routeAdapterPlan.bindings
			]
		},
		adapter: routeAdapterPlan.adapter,
		httpRoutes: [result.route]
	})
	const [runtimePlan] = lowerBalancedHttpAppPlan(
		application,
		routeOptions.adapter
	)
	return {
		application,
		plan: runtimePlan!,
		runtime: compileBalancedHttpRoute(runtimePlan!)
	}
}

const compileRouteFromPlan = (routeOptions: ReturnType<typeof options>) =>
	compileFromAppPlan(routeOptions).runtime

describe('balanced HTTP route planning', () => {
	it('shares empty runtime support values across plain routes', () => {
		const first = planBalancedHttpRoute(
			options(() => 'a', state({ path: '/a' }))
		)
		const second = planBalancedHttpRoute(
			options(() => 'b', state({ path: '/b' }))
		)
		if (!first.supported || !second.supported) throw new Error('route unsupported')
		const [a, b] = lowerBalancedHttpAppPlan(
			appPlan(first.route, second.route),
			WebStandardAdapter
		)

		expect(a!.hooks).toBe(b!.hooks)
		expect(a!.maybeValidatorSlots).toBe(b!.maybeValidatorSlots)
		expect(a!.tracers).toBe(b!.tracers)
	})

	it('counts traced routes without rechecking the seal-time cancellation policy', () => {
		const covered = planBalancedHttpRoute(options(() => 'ok'))
		const traced = planBalancedHttpRoute(
			options(
				() => 'trace',
				state(
					{ hasTrace: true, traceCount: 1 },
					{
						traceHandlers: [() => {}],
						tracePhases: new Set<any>(['handle'])
					}
				)
			)
		)
		const compat = planBalancedHttpRoute(
			options(
				() => 'removed',
				state(),
				undefined,
				new Elysia({ experimental: { cancellation: 'compat' } })
			)
		)
		expect(() => sealBalancedHttpRoutes([covered, traced, compat], 3)).not.toThrow()
		expect(() => sealBalancedHttpRoutes([covered, traced], 3)).toThrow(
			'[BALANCED_HTTP_COVERAGE] planned 2/3 winning routes'
		)
		expect(traced.supported).toBeTrue()
	})

	it('does not retain the owner app in a supported plan', () => {
		const root = new Elysia()
		const result = planBalancedHttpRoute(
			options(() => 'ok', state(), undefined, root)
		)
		expect(result.supported).toBeTrue()
		if (!result.supported) return
		const application = appPlan(result.route)
		const [runtime] = lowerBalancedHttpAppPlan(application, WebStandardAdapter)
		expect(Object.values(result.route)).not.toContain(root)
		expect(Object.values(runtime!)).not.toContain(root)
		expect(
			Object.isFrozen(application.httpRoutes[0]!.program.content)
		).toBeTrue()
		expect(Object.isFrozen(runtime)).toBeTrue()
		expect(runtime).not.toHaveProperty('state')
		expect(runtime).not.toHaveProperty('descriptor')
		expect(runtime).not.toHaveProperty('root')
		expect(runtime).not.toHaveProperty('jit')
		expect(
			JSON.parse(JSON.stringify(application.httpRoutes[0]!.program.content))
		).toEqual(application.httpRoutes[0]!.program.content)
	})

	it('rejects a same-name ambient adapter with different callbacks', () => {
		const result = planBalancedHttpRoute(options(() => 'ok'))
		expect(result.supported).toBeTrue()
		if (!result.supported) return
		const application = appPlan(result.route)

		expect(() => lowerBalancedHttpAppPlan(application)).not.toThrow()
		expect(() =>
			lowerBalancedHttpAppPlan(application, {
				...WebStandardAdapter,
				response: {
					...WebStandardAdapter.response,
					map: () => new Response('poisoned')
				}
			} as any)
		).toThrow('[BALANCED_HTTP_BINDING] ambient adapter mismatch')
	})

	it('fails lowering on route-count and binding-role corruption', () => {
		const result = planBalancedHttpRoute(options(() => 'ok'))
		expect(result.supported).toBeTrue()
		if (!result.supported) return
		const application = appPlan(result.route)

		expect(() =>
			lowerBalancedHttpAppPlan(
				{
					...application,
					coverage: {
						...application.coverage,
						plannedHttpRoutes: 0
					}
				} as any,
				WebStandardAdapter
			)
		).toThrow('[BALANCED_HTTP_COVERAGE] planned 0/1 winning routes')

		const handlerIndex = application.httpRoutes[0]!.program.bindingIndices[0]!
		expect(() =>
			lowerBalancedHttpAppPlan(
				{
					...application,
					bindingLayout: application.bindingLayout.map((binding, index) =>
						index === handlerIndex
							? { ...binding, role: 'mapResponse' }
							: binding
					)
				} as any,
				WebStandardAdapter
			)
		).toThrow('[BALANCED_HTTP_BINDING] GET / expected handler')

		expect(() =>
			lowerBalancedHttpAppPlan(
				{
					...application,
					externalBindings: application.externalBindings.slice(0, -1)
				} as any,
				WebStandardAdapter
			)
		).toThrow('[BALANCED_HTTP_APP_PLAN] inconsistent coverage or sidecar')

		const route = application.httpRoutes[0]!
		const programContent = route.program.content as any
		expect(() =>
			lowerBalancedHttpAppPlan(
				{
					...application,
					httpRoutes: [{ ...route, handlerForm: 'garbage' }]
				} as any,
				WebStandardAdapter
			)
		).toThrow('[BALANCED_HTTP_APP_PLAN] invalid HTTP route identity')

		for (const content of [
			{ ...programContent, contextMode: 'garbage' },
			{
				...programContent,
				responseSink: 2,
				defaultHeaders: null
			},
			{
				...programContent,
				body: {
					...(route.program.content as any).body,
					enabled: true,
					mode: 'builtin',
					builtin: 'evil',
					parserCount: 1
				}
			}
		])
			expect(() =>
				lowerBalancedHttpAppPlan(
					{
						...application,
						httpRoutes: [
							{
								...route,
								program: { ...route.program, content }
							}
						]
					} as any,
					WebStandardAdapter
				)
			).toThrow('[BALANCED_HTTP_PROGRAM] invalid program content')

		const transforms = planBalancedHttpRoute(
			options(() => 'ok', state(), {
				transform: [() => undefined, () => undefined]
			})
		)
		expect(transforms.supported).toBeTrue()
		if (!transforms.supported) return
		const transformApp = appPlan(transforms.route)
		const [first, second] = transformApp.lifecycleSegments
		expect(() =>
			lowerBalancedHttpAppPlan(
				{
					...transformApp,
					lifecycleSegments: [
						{
							...first!,
							bindingIndex: second!.bindingIndex
						},
						second!
					]
				} as any,
				WebStandardAdapter
			)
		).toThrow('invalid lifecycle segment')
		expect(() =>
			lowerBalancedHttpAppPlan(
				{
					...transformApp,
					externalBindings: transformApp.externalBindings.map((value, index) =>
						index === first!.bindingIndex ? 1 : value
					)
				} as any,
				WebStandardAdapter
			)
		).toThrow('invalid lifecycle binding')
	})

	it('binds every retained handler form with its exact role', () => {
		const forms: Array<{
			form: 'function' | 'response' | 'static-value' | 'promise' | 'mount'
			handler: unknown
			kind: RouteDescriptor['handlerKind']
			role: string
		}> = [
			{
				form: 'function',
				handler: () => 'ok',
				kind: 'function',
				role: 'handler'
			},
			{
				form: 'response',
				handler: new Response('ok'),
				kind: 'response',
				role: 'response'
			},
			{
				form: 'static-value',
				handler: 'ok',
				kind: 'static-value',
				role: 'staticValue'
			},
			{
				form: 'promise',
				handler: Promise.resolve('ok'),
				kind: 'promise',
				role: 'staticValue'
			},
			{ form: 'mount', handler: () => 'ok', kind: 'function', role: 'mount' }
		]

		for (const { form, handler, kind, role } of forms) {
			const result = planBalancedHttpRoute({
				...options(handler, state({ handlerKind: kind })),
				handlerForm: form
			})
			expect(result.supported).toBeTrue()
			if (!result.supported) continue
			const application = appPlan(result.route)
			const route = application.httpRoutes[0]!
			expect(route.handlerForm).toBe(form)
			expect(
				application.bindingLayout[route.program.bindingIndices[0]!]!.role
			).toBe(role as any)
		}
	})

	it('encodes all four retained response sinks exactly', () => {
		const defaultResponseState = {
			headers: { 'x-default': 'yes' }
		}
		const classes: Array<
			[RouteDescriptor['responseMode'], number, number, boolean]
		> = [
			['compact', 0, 0, false],
			['set', 1, 0, false],
			['default-headers', 2, 0, true],
			['set-with-default-headers', 3, RouteEffect.SetHeaders, true]
		]

		for (const [
			responseMode,
			responseSink,
			effectMask,
			hasDefaults
		] of classes) {
			const result = planBalancedHttpRoute(
				options(
					() => 'ok',
					state(
						{
							responseMode,
							effectMask,
							contextMode:
								responseSink === 1 || responseSink === 3 ? 'set' : 'compact'
						},
						{
							defaultResponseState: hasDefaults
								? defaultResponseState
								: undefined
						}
					)
				)
			)
			expect(result.supported).toBeTrue()
			if (!result.supported) continue
			const application = appPlan(result.route)
			const [runtime] = lowerBalancedHttpAppPlan(
				application,
				WebStandardAdapter
			)
			expect(
				(application.httpRoutes[0]!.program.content as any).responseSink
			).toBe(responseSink)
			expect(runtime!.program.responseSink).toBe(responseSink as any)
			expect(runtime!.defaultResponseState?.headers['x-default']).toBe(
				hasDefaults ? 'yes' : undefined
			)
		}
	})

	it('snapshots hook sequences against mutation after seal', () => {
		const transforms = [() => {}]
		const prefix = [() => {}]
		const result = planBalancedHttpRoute(
			options(() => 'ok', state({}, { beforeHandlePrefix: prefix }), {
				transform: transforms
			})
		)
		expect(result.supported).toBeTrue()
		expect(Object.isFrozen(transforms)).toBeFalse()
		expect(Object.isFrozen(prefix)).toBeFalse()
		if (!result.supported) return
		const application = appPlan(result.route)
		const plannedTransform = result.route.lifecycle![0]!.bindings as any[]
		plannedTransform[0] = { role: 'transform', value: () => 1 }
		plannedTransform.push({ role: 'transform', value: () => 2 })
		transforms.push(() => 3)
		prefix.push(() => 4)
		const [runtime] = lowerBalancedHttpAppPlan(application, WebStandardAdapter)
		expect(runtime!.hooks.transforms).not.toBe(transforms)
		expect(runtime!.hooks.transforms.length).toBe(1)
		expect(runtime!.hooks.before.length).toBe(1)
	})

	it('owns the error finalizer once at application scope', () => {
		const compiled = compileFromAppPlan(options(() => 'ok'))
		const finalizers = compiled.application.bindingLayout.filter(
			({ role }) => role === 'routeErrorFinalizer'
		)

		expect(finalizers).toEqual([
			{ nodeId: 0, role: 'routeErrorFinalizer', ordinal: 0 }
		])
		expect(
			compiled.application.httpRoutes[0]!.bindingIndices.some(
				(index) =>
					compiled.application.bindingLayout[index]!.role ===
					'routeErrorFinalizer'
			)
		).toBe(false)
		expect(compiled.plan.finalizeError as unknown).toBe(
			compiled.application.externalBindings[
				compiled.application.application.bindingIndices.find(
					(index) =>
						compiled.application.bindingLayout[index]!.role ===
						'routeErrorFinalizer'
				)!
			]
		)
	})

	it('seals one exact ordered binding grammar into AppPlan', () => {
		const parser = () => undefined
		const transform = () => undefined
		const prefix = () => undefined
		const derive = () => ({ derived: true })
		const after = () => undefined
		const map = () => undefined
		const cleanup = () => undefined
		const error = () => undefined
		const tracer = () => undefined
		const vali = sealedValidators({
			query: t.Object({ q: t.String() }),
			response: { 200: t.String() }
		})
		const cookieConfig = compileCookieConfig(undefined, undefined)
		const hook = {
			transform: [transform],
			beforeHandle: [derive],
			afterHandle: [after],
			mapResponse: [map],
			afterResponse: [cleanup],
			error: [error],
			'~deriveEntries': [derive]
		}
		const result = planBalancedHttpRoute(
			options(
				() => 'ok',
				state(
					{
						bodyPlan: {
							...bodyPlan,
							enabled: true,
							mode: 'chain',
							parserCount: 1,
							custom: true,
							fallback: true,
							presence: 'framing'
						},
						hasBody: true,
						hasTrace: true,
						traceCount: 1,
						hasResponseValidator: true
					},
					{
						bodyParserHooks: [parser],
						beforeHandlePrefix: [prefix],
						traceHandlers: [tracer],
						tracePhases: new Set<any>(['handle']),
						cookieConfig,
						vali
					}
				),
				hook,
				new Elysia({ experimental: { validationPlan: true } }) as any
			)
		)
		expect(result.supported).toBeTrue()
		if (!result.supported) return
		const application = appPlan(result.route)
		expect(application.bindingLayout.map(({ role }) => role)).toEqual([
			'adapterParse',
			'adapterMap',
			'adapterCompact',
			'parser',
			'tracer',
			'transform',
			'beforeHandle',
			'derive',
			'afterHandle',
			'mapResponse',
			'afterResponse',
			'error',
			'handler',
			'queryValidator',
			'responseValidator'
		])
		expect(application.httpRoutes[0]!.bindingIndices).toEqual([3, 4])
		expect(application.coverage).toMatchObject({
			winningHttpRoutes: 1,
			plannedHttpRoutes: 1
		})
		expect(application.httpRoutes[0]!.program.content).not.toHaveProperty(
			'validatorAsyncMask'
		)
		expect(application.httpRoutes[0]!.program.content).not.toHaveProperty(
			'responseValidatorAsync'
		)
		expect(
			(application.httpRoutes[0]!.program.content as any).cookie
		).not.toHaveProperty('validatorAsync')
		const queryBinding = application.externalBindings[
			application.httpRoutes[0]!.validators.find(
				({ slot }) => slot === 'query'
			)!.bindingIndices[0]!
		] as any
		expect(Object.isFrozen(queryBinding)).toBe(true)
		expect(Object.isFrozen(queryBinding.validator)).toBe(true)
		expect(queryBinding.validator.schema).toBeUndefined()
		expect(Object.isFrozen(queryBinding.queryPlan)).toBe(true)
	})

	it('rejects validator artifact, slot, and response ordinal corruption', () => {
		const vali = sealedValidators({
			body: t.Object({ value: t.String() }),
			response: { 200: t.String(), 201: t.String() }
		})
		const result = planBalancedHttpRoute(
			options(() => 'ok', state({}, { vali }))
		)
		expect(result.supported).toBeTrue()
		if (!result.supported) return
		const application = appPlan(result.route)
		const route = application.httpRoutes[0]!
		const [body, firstResponse, secondResponse] = route.validators

		expect(() =>
			lowerBalancedHttpAppPlan(
				{
					...application,
					httpRoutes: [
						{
							...route,
							validators: [
								{
									...body!,
									artifact: {
										...(body!.artifact as any),
										corrupt: true
									}
								},
								firstResponse!,
								secondResponse!
							]
						}
					]
				} as any,
				WebStandardAdapter
			)
		).toThrow('validator artifact mismatch')

		expect(() =>
			lowerBalancedHttpAppPlan(
				{
					...application,
					httpRoutes: [
						{
							...route,
							validators: [
								body!,
								{ ...firstResponse!, slot: 'body' },
								secondResponse!
							]
						}
					]
				} as any,
				WebStandardAdapter
			)
		).toThrow('validator slot mismatch')

		expect(() =>
			lowerBalancedHttpAppPlan(
				{
					...application,
					httpRoutes: [
						{
							...route,
							validators: [
								body!,
								{
									...firstResponse!,
									bindingIndices: secondResponse!.bindingIndices
								},
								{
									...secondResponse!,
									bindingIndices: firstResponse!.bindingIndices
								}
							]
						}
					]
				} as any,
				WebStandardAdapter
			)
		).toThrow('expected responseValidator:0')
	})

	it('fingerprints canonical cookie policy while keeping only secrets opaque', () => {
		const planned = (path: string, secrets: string) => {
			const result = planBalancedHttpRoute(
				options(
					() => 'ok',
					state(
						{ hasCookieSign: true },
						{
							cookieConfig: compileCookieConfig(undefined, {
								path,
								sign: true,
								secrets
							})
						}
					)
				)
			)
			expect(result.supported).toBeTrue()
			if (!result.supported) throw new Error('cookie route must plan')
			return appPlan(result.route)
		}
		const first = planned('/a', 'alpha')
		const policyChange = planned('/b', 'alpha')
		const secretChange = planned('/a', 'beta')
		expect(first.httpRoutes[0]!.program.content).not.toEqual(
			policyChange.httpRoutes[0]!.program.content
		)
		expect(first.httpRoutes[0]!.program.content).toEqual(
			secretChange.httpRoutes[0]!.program.content
		)
		expect(first.bindingLayout.map(({ role }) => role)).toEqual([
			'adapterParse',
			'adapterMap',
			'adapterCompact',
			'cookieCryptoProvider',
			'handler'
		])
		const [runtime] = lowerBalancedHttpAppPlan(first, WebStandardAdapter)
		expect(runtime!.cookieConfig?.defaults.path).toBe('/a')
		expect(runtime!.cookieConfig?.globalSecrets).toBe('alpha')
	})

	it('leaves compat rejection to sealing and retains parser behavior', () => {
		const compat = planBalancedHttpRoute(
			options(
				() => 'late',
				state(),
				undefined,
				new Elysia({ experimental: { cancellation: 'compat' } })
			)
		)
		expect(compat.supported).toBeTrue()
		for (const parser of ['json', () => undefined]) {
			const retained = planBalancedHttpRoute(
				options(
					() => 'body',
					state(
						{
							bodyPlan: {
								...bodyPlan,
								enabled: true,
								mode: 'chain',
								parserCount: 1,
								custom: typeof parser === 'function',
								fallback: typeof parser === 'function',
								presence: typeof parser === 'function' ? 'framing' : 'none'
							}
						},
						{ bodyParserHooks: [parser] }
					)
				)
			)
			expect(retained.supported).toBeTrue()
		}

		const invalidParser = planBalancedHttpRoute(
			options(
				() => 'body',
				state({
					bodyPlan: {
						...bodyPlan,
						enabled: true,
						mode: 'builtin',
						builtin: 'not-a-parser'
					}
				})
			)
		)
		expect(invalidParser).toMatchObject({
			supported: false,
			reason: 'unsupported-parser'
		})
		const invalidObjectParser = planBalancedHttpRoute(
			options(
				() => 'body',
				state(
					{
						bodyPlan: {
							...bodyPlan,
							enabled: true,
							mode: 'chain',
							parserCount: 1,
							custom: true
						}
					},
					{ bodyParserHooks: [{}] }
				)
			)
		)
		expect(invalidObjectParser).toMatchObject({
			supported: false,
			reason: 'unsupported-parser'
		})
	})
})

describe('balanced HTTP shared kernel', () => {
	it('does not run cleanup hooks after an unhandled post-handler failure', async () => {
		const cleanup: string[] = []
		const compiled = compileFromAppPlan(
			options(
				() => 'ok',
				state({
					hasAfterHandle: true,
					hasAfterResponse: true,
					hasLifecycleHook: true
				}),
				{
					afterHandle: [() => Promise.reject(new Error('after'))],
					afterResponse: [() => cleanup.push('afterResponse')]
				}
			)
		).runtime

		expect(
			await responseShape(
				compiled(context(new Request('http://localhost/'))) as any
			)
		).toMatchObject({ body: 'final:after' })
		await Bun.sleep(0)
		expect(cleanup).toEqual([])
	})

	it('runs non-stream cleanup in the mapper microtask order', async () => {
		const order: string[] = []
		const adapter = {
			...WebStandardAdapter,
			name: 'microtask-order',
			response: {
				...WebStandardAdapter.response,
				compact(value: unknown) {
					order.push('map')
					queueMicrotask(() => order.push('mapMicro'))
					return new Response(String(value))
				}
			}
		} as any
		const routeOptions = options(
			() => 'ok',
			state({ hasAfterResponse: true, hasLifecycleHook: true }),
			{ afterResponse: [() => order.push('afterResponse')] }
		)
		const compiled = compileFromAppPlan({
			...routeOptions,
			adapter
		}).runtime

		await responseShape(
			compiled(context(new Request('http://localhost/'))) as any
		)
		await Bun.sleep(0)
		expect(order).toEqual(['map', 'afterResponse', 'mapMicro'])
	})

	it('executes custom and named parser bindings from AppPlan', async () => {
		const parserClasses: Array<[unknown, string, string]> = [
			[
				({ contentType }: any) => `custom:${contentType}`,
				'application/custom',
				'custom:application/custom'
			],
			['text', 'text/plain', 'named']
		]

		for (const [parser, contentType, expected] of parserClasses) {
			const compiled = compileFromAppPlan(
				options(
					({ body }: any) => body,
					state(
						{
							method: 'POST',
							bodyPlan: {
								...bodyPlan,
								enabled: true,
								mode: 'chain',
								parserCount: 1,
								custom: typeof parser === 'function',
								fallback: typeof parser === 'function',
								presence: typeof parser === 'function' ? 'framing' : 'none'
							},
							hasBody: true
						},
						{ bodyParserHooks: [parser] }
					)
				)
			)
			const response = await compiled.runtime(
				context(
					new Request('http://localhost/', {
						method: 'POST',
						headers: { 'content-type': contentType },
						body: parser === 'text' ? expected : 'ignored'
					})
				)
			)
			expect(await (response as Response).text()).toBe(expected)
		}
	})

	it('matches legacy context, body, and lifecycle behavior', async () => {
		const order: string[] = []
		const hook = {
			transform: [() => void order.push('transform')],
			beforeHandle: [() => void order.push('before')],
			afterHandle: [
				({ responseValue }: any) => {
					order.push('after')
					return `${responseValue}:after`
				}
			],
			mapResponse: [() => void order.push('map')]
		}
		const handler = ({ params, query, headers, body }: any) => {
			order.push('handler')
			return `${params.id}:${query.q}:${headers['x-test']}:${body.name}`
		}
		const routeState = state({
			method: 'POST',
			path: '/item/:id',
			async: true,
			bodyPlan: {
				...bodyPlan,
				enabled: true,
				mode: 'builtin',
				builtin: 'json',
				parserCount: 1
			},
			hasBody: true,
			effectMask: RouteEffect.Query | RouteEffect.Headers,
			headerKeys: ['x-test'],
			hasBeforeHandle: true,
			hasAfterHandle: true,
			hasMapResponse: true,
			hasLifecycleHook: true
		})
		const compiled = compileFromAppPlan(options(handler, routeState, hook))
		const runtime = compiled.runtime
		const request = new Request('http://localhost/item/7?q=yes', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-test': 'header'
			},
			body: JSON.stringify({ name: 'body' })
		})
		const actual = await responseShape(
			runtime(context(request, { id: '7' })) as any
		)

		const legacy = new Elysia().post(
			'/item/:id',
			{
				parse: 'json',
				transform: () => {},
				beforeHandle: () => {},
				afterHandle: ({ responseValue }) => `${responseValue}:after`,
				mapResponse: () => {}
			},
			({ params, query, headers, body }: any) =>
				`${params.id}:${query.q}:${headers['x-test']}:${body.name}`
		)
		const expected = await responseShape(
			legacy.handle(
				new Request('http://localhost/item/7?q=yes', {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'x-test': 'header'
					},
					body: JSON.stringify({ name: 'body' })
				})
			)
		)

		expect(actual).toEqual(expected)
		expect(order).toEqual(['transform', 'before', 'handler', 'after', 'map'])
		expect(compiled.application.httpRoutes).toHaveLength(1)
		expect(compiled.plan.program.kind).toBe('balanced-http')
	})

	it('assimilates handler and lifecycle thenables once', async () => {
		let handlerThen = 0
		let beforeThen = 0
		const thenable = (value: unknown, count: () => void) => ({
			get then() {
				count()
				return (resolve: (value: unknown) => void) => resolve(value)
			}
		})
		const hook = {
			beforeHandle: [() => thenable(undefined, () => beforeThen++)]
		}
		const runtime = compileRouteFromPlan(
			options(
				() => thenable('settled', () => handlerThen++),
				state({
					async: true,
					hasBeforeHandle: true,
					hasLifecycleHook: true
				}),
				hook
			)
		)

		expect(
			await responseShape(
				runtime(context(new Request('http://localhost/'))) as any
			)
		).toMatchObject({ status: 200, body: 'settled' })
		expect({ handlerThen, beforeThen }).toEqual({
			handlerThen: 1,
			beforeThen: 1
		})
	})

	it('routes rejected and throwing-getter thenables through errors', async () => {
		for (const [handler, expected] of [
			[
				() => ({
					then: (_resolve: AnyFn, reject: AnyFn) => reject(new Error('reject'))
				}),
				'handled:reject'
			],
			[
				() =>
					Object.defineProperty({}, 'then', {
						get() {
							throw new Error('getter')
						}
					}),
				'handled:getter'
			]
		] as const) {
			const runtime = compileRouteFromPlan(
				options(
					handler,
					state({ hasErrorHook: true, hasLifecycleHook: true }),
					{ error: [({ error }: any) => `handled:${error.message}`] }
				)
			)
			expect(
				await responseShape(
					runtime(context(new Request('http://localhost/'))) as any
				)
			).toMatchObject({ status: 500, body: expected })
		}
	})

	it('matches legacy cleanup and finalizer boundaries on route errors', async () => {
		const after: string[] = []
		const unhandled = compileRouteFromPlan(
			options(
				() => {
					throw new Error('route')
				},
				state({ hasAfterResponse: true, hasLifecycleHook: true }),
				{ afterResponse: [() => void after.push('after')] }
			)
		)
		expect(
			await responseShape(
				unhandled(context(new Request('http://localhost/'))) as any
			)
		).toMatchObject({ status: 500, body: 'final:route' })
		await Bun.sleep(0)
		expect(after).toEqual([])

		const handledAfter: unknown[] = []
		const handled = compileRouteFromPlan(
			options(
				() => {
					throw new Error('route')
				},
				state({
					hasErrorHook: true,
					hasAfterResponse: true,
					hasLifecycleHook: true
				}),
				{
					error: [() => 'handled'],
					afterResponse: [
						({ responseValue }: any) => void handledAfter.push(responseValue)
					]
				}
			)
		)
		await handled(context(new Request('http://localhost/')))
		await Bun.sleep(0)
		expect(handledAfter).toEqual([undefined])

		const rejectedMapOptions = options(
			() => {
				throw new Error('route')
			},
			state({ hasErrorHook: true, hasLifecycleHook: true }),
			{ error: [() => 'handled'] }
		)
		;(rejectedMapOptions as any).adapter = {
			...WebStandardAdapter,
			response: {
				...WebStandardAdapter.response,
				map: () => Promise.reject(new Error('mapfail'))
			}
		}
		const rejectedMap = compileRouteFromPlan(rejectedMapOptions)
		expect(
			await responseShape(
				rejectedMap(context(new Request('http://localhost/'))) as any
			)
		).toMatchObject({ status: 500, body: 'final:mapfail' })
	})

	it('runs validators, afterResponse cleanup, and suspension cancellation', async () => {
		const after: unknown[] = []
		const vali = sealedValidators({
			query: t.Object({
				q: t
					.Codec(t.String())
					.Decode((value) => `${value}:decoded`)
					.Encode((value) => value.replace(/:decoded$/, ''))
			}),
			response: {
				200: t
					.Codec(t.String())
					.Decode((value) => value)
					.Encode((value) => `${value}:encoded`)
			}
		})
		const routeState = state(
			{
				responseMode: 'set',
				contextMode: 'set',
				effectMask: RouteEffect.Query,
				hasAfterResponse: true,
				hasMapResponse: true,
				hasResponseValidator: true,
				hasLifecycleHook: true
			},
			{ vali }
		)
		const runtime = compileRouteFromPlan(
			options(({ query }: any) => query.q, routeState, {
				mapResponse: [({ responseValue }: any) => `${responseValue}:mapped`],
				afterResponse: [
					({ responseValue }: any) => void after.push(responseValue)
				]
			})
		)
		expect(
			await responseShape(
				runtime(context(new Request('http://localhost/?q=yes'))) as any
			)
		).toMatchObject({ body: 'yes:decoded:mapped:encoded' })
		await Bun.sleep(0)
		expect(after).toEqual(['yes:decoded:mapped'])

		const controller = new AbortController()
		const cancelled = compileRouteFromPlan(
			options(() => ({
				then(resolve: Function) {
					controller.abort()
					resolve('late')
				}
			}))
		)
		expect(
			await responseShape(
				cancelled(
					context(
						new Request('http://localhost/', {
							signal: controller.signal
						})
					)
				) as any
			)
		).toMatchObject({ status: 200, body: '' })
	})

	it('derives maybe-settlement only from the validator artifact', async () => {
		const vali = sealedValidators({
			body: {
				'~standard': {
					version: 1,
					vendor: 'balanced-test',
					validate: async (value: unknown) => ({
						value: `${value}:validated`
					})
				}
			} as any
		})
		const runtime = compileRouteFromPlan(
			options(
				({ body }: any) => body,
				state(
					{
						method: 'POST',
						bodyPlan: {
							...bodyPlan,
							enabled: true,
							mode: 'builtin',
							builtin: 'text',
							parserCount: 1
						},
						bodyValiIsAsync: false,
						hasBody: true
					},
					{ vali }
				)
			)
		)

		expect(
			await responseShape(
				runtime(
					context(
						new Request('http://localhost/', {
							method: 'POST',
							headers: { 'content-type': 'text/plain' },
							body: 'value'
						})
					)
				) as any
			)
		).toMatchObject({ body: 'value:validated' })
	})

	it('uses the certified generic query plan without enabling ValidationPlan', async () => {
		const vali = sealedValidators({
			query: t.Object({ tag: t.Array(t.String()) })
		})
		const runtime = compileRouteFromPlan(
			options(
				({ query }: any) => JSON.stringify(query.tag),
				state({ effectMask: RouteEffect.Query }, { vali })
			)
		)

		expect(
			await responseShape(
				runtime(
					context(new Request('http://localhost/?tag=first&tag=second'))
				) as any
			)
		).toMatchObject({ body: '["first","second"]' })
	})

	it('assimilates application lifecycle thenables exactly once', async () => {
		const thenable = (
			value: unknown,
			mode: 'fulfill' | 'reject' | 'throw-getter',
			counts: { getter: number; invoke: number }
		) =>
			Object.defineProperty({}, 'then', {
				get() {
					counts.getter++
					if (mode === 'throw-getter') throw new Error('getter')
					return (resolve: Function, reject: Function) => {
						counts.invoke++
						if (mode === 'reject') reject(new Error(String(value)))
						else resolve(value)
					}
				}
			})

		for (const boundary of ['request', 'mapResponse', 'error'] as const) {
			const counts = { getter: 0, invoke: 0 }
			let app = new Elysia()
			if (boundary === 'request')
				app = app.request(() => thenable('early', 'fulfill', counts))
			else if (boundary === 'mapResponse')
				app = app
					.request(() => 'early')
					.mapResponse(() => thenable('mapped', 'fulfill', counts))
			else
				app = app
					.request(() => {
						throw new Error('request')
					})
					.error(() => thenable('handled', 'fulfill', counts))
			app = app.get('/', () => 'route')

			expect(
				await app.handle(new Request('http://localhost/')).then((x) => x.text())
			).toBe(
				boundary === 'request'
					? 'early'
					: boundary === 'mapResponse'
						? 'mapped'
						: 'handled'
			)
			expect(counts).toEqual({ getter: 1, invoke: 1 })
		}

		for (const mode of ['reject', 'throw-getter'] as const) {
			const counts = { getter: 0, invoke: 0 }
			const app = new Elysia()
				.request(() => thenable('rejected', mode, counts))
				.error(({ error }) => (error as Error).message)
				.get('/', () => 'route')

			expect(
				await app.handle(new Request('http://localhost/')).then((x) => x.text())
			).toBe(mode === 'reject' ? 'rejected' : 'getter')
			expect(counts).toEqual({
				getter: 1,
				invoke: mode === 'reject' ? 1 : 0
			})
		}
	})

	it('executes traced AppPlan phases in legacy order', async () => {
		const events: string[] = []
		const tracer = ({
			onParse,
			onTransform,
			onBeforeHandle,
			onHandle,
			onAfterHandle,
			onMapResponse,
			onAfterResponse,
			onError
		}: any) => {
			onParse(() => events.push('parse'))
			onTransform(() => events.push('transform'))
			onBeforeHandle(() => events.push('before'))
			onHandle(() => events.push('handle'))
			onAfterHandle(() => events.push('after'))
			onMapResponse(() => events.push('map'))
			onAfterResponse(() => events.push('afterResponse'))
			onError(() => events.push('error'))
		}
		const hook = {
			transform: [function transform() {}],
			beforeHandle: [function before() {}],
			afterHandle: [function after() {}],
			mapResponse: [function map() {}],
			afterResponse: [function cleanup() {}]
		}
		const routeState = state(
			{
				method: 'POST',
				bodyPlan: {
					...bodyPlan,
					enabled: true,
					mode: 'builtin',
					builtin: 'json',
					parserCount: 1
				},
				hasBody: true,
				hasTrace: true,
				traceCount: 1,
				hasBeforeHandle: true,
				hasAfterHandle: true,
				hasMapResponse: true,
				hasAfterResponse: true,
				hasLifecycleHook: true
			},
			{
				traceHandlers: [tracer],
				tracePhases: null,
				hasAnyPhase: true,
				traceHandleOn: true
			}
		)
		const compiled = compileFromAppPlan(
			options(
				function handler() {
					return 'ok'
				},
				routeState,
				hook
			)
		)
		const requestContext = context(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			})
		)
		expect(
			await responseShape(compiled.runtime(requestContext) as any)
		).toMatchObject({ status: 200, body: 'ok' })
		await Bun.sleep(0)
		expect(events).toEqual([
			'parse',
			'transform',
			'before',
			'handle',
			'after',
			'map',
			'afterResponse'
		])
		expect(events).not.toContain('error')
		expect((requestContext as any).trace).toHaveLength(1)
		expect((requestContext as any).trace[0]).toBeDefined()
	})

	it('reuses application trace handles and preserves phase-specific errors', async () => {
		let applicationCreates = 0
		let siblingCreates = 0
		let requestStopped = false
		let correlated = false
		let transformError: unknown = 'unset'
		const applicationTrace = ({ onRequest }: any) => {
			applicationCreates++
			onRequest(({ onStop }: any) =>
				onStop(() => {
					requestStopped = true
				})
			)
		}
		const siblingTrace = ({ onHandle, onTransform }: any) => {
			siblingCreates++
			onHandle(({ onStop }: any) =>
				onStop(() => {
					correlated = requestStopped
				})
			)
			onTransform(({ onEvent }: any) =>
				onEvent(({ onStop }: any) =>
					onStop(({ error }: any) => {
						transformError = error
					})
				)
			)
		}
		const requestContext = context(new Request('http://localhost/'))
		requestContext.rid = 1
		const handles = createTraceHandles(requestContext, [
			applicationTrace,
			siblingTrace
		])
		;(requestContext as any).trace = handles
		const requestReport =
			handles[0].b(0, 0) ||
			handles[0].begin(0, {
				id: 1,
				event: 'request',
				name: 'request',
				begin: performance.now(),
				total: 0
			})
		handles[0].r(requestReport)

		const runtime = compileFromAppPlan(
			options(
				() => 'ok',
				state(
					{
						hasTrace: true,
						traceCount: 1,
						hasLifecycleHook: true
					},
					{
						traceHandlers: [siblingTrace],
						tracePhases: new Set<any>(['transform', 'handle'])
					}
				),
				{ transform: [() => new Error('value')] }
			)
		).runtime
		await responseShape(runtime(requestContext) as any)
		await Bun.sleep(0)
		expect({ applicationCreates, siblingCreates }).toEqual({
			applicationCreates: 1,
			siblingCreates: 1
		})
		expect(correlated).toBeTrue()
		expect(transformError).toBeNull()
	})

	it('reports one wrapped parse error to both child and parent traces', async () => {
		let childError: unknown
		let groupError: unknown
		const parser = () => {
			throw new Error('raw parser cause')
		}
		const runtime = compileFromAppPlan(
			options(
				() => 'unreachable',
				state(
					{
						method: 'POST',
						bodyPlan: {
							...bodyPlan,
							enabled: true,
							mode: 'chain',
							parserCount: 1,
							custom: true,
							fallback: true,
							presence: 'framing'
						},
						hasBody: true,
						hasTrace: true,
						traceCount: 1,
						hasErrorHook: true,
						hasLifecycleHook: true
					},
					{
						bodyParserHooks: [parser],
						traceHandlers: [
							({ onParse }: any) =>
								onParse(({ onEvent, onStop }: any) => {
									onEvent(({ onStop: onChildStop }: any) =>
										onChildStop(({ error }: any) => {
											childError = error
										})
									)
									onStop(({ error }: any) => {
										groupError = error
									})
								})
						],
						tracePhases: new Set<any>(['parse'])
					}
				),
				{ error: [() => 'handled'] }
			)
		).runtime
		expect(
			await responseShape(
				runtime(
					context(
						new Request('http://localhost/', {
							method: 'POST',
							headers: { 'content-type': 'application/custom' },
							body: 'body'
						})
					)
				) as any
			)
		).toMatchObject({ body: 'handled' })
		expect(childError).toBe(groupError)
		expect((childError as Error).name).toBe('ParseError')
	})

	it('traces errors and drains 70-chunk cleanup observers without deadlock', async () => {
		const errors: string[] = []
		const errorRuntime = compileFromAppPlan(
			options(
				() => {
					throw new Error('boom')
				},
				state(
					{
						hasTrace: true,
						traceCount: 1,
						hasErrorHook: true,
						hasLifecycleHook: true
					},
					{
						traceHandlers: [
							({ onError }: any) => onError(() => errors.push('error'))
						],
						tracePhases: new Set<any>(['error'])
					}
				),
				{ error: [() => 'handled'] }
			)
		).runtime
		expect(
			await responseShape(
				errorRuntime(context(new Request('http://localhost/'))) as any
			)
		).toMatchObject({ status: 500, body: 'handled' })
		expect(errors).toEqual(['error'])

		const order: string[] = []
		const streamRuntime = compileFromAppPlan(
			options(
				function* stream() {
					for (let i = 0; i < 70; i++) yield 'x'
				},
				state(
					{
						hasTrace: true,
						traceCount: 1,
						hasAfterResponse: true,
						hasLifecycleHook: true
					},
					{
						traceHandlers: [
							({ onHandle }: any) =>
								onHandle(({ onStop }: any) =>
									onStop(() => order.push('handle'))
								)
						],
						tracePhases: new Set<any>(['handle']),
						traceHandleOn: true
					}
				),
				{ afterResponse: [() => void order.push('cleanup')] }
			)
		).runtime
		const response = (await streamRuntime(
			context(new Request('http://localhost/'))
		)) as Response
		const text = await Promise.race([
			response.text(),
			Bun.sleep(1000).then(() => {
				throw new Error('stream observer deadlock')
			})
		])
		expect(text).toHaveLength(70)
		await Bun.sleep(0)
		expect(order).toEqual(['handle', 'cleanup'])
	})

	it('closes replaced and failed stream branches without duplicate cleanup', async () => {
		const replaced: string[] = []
		const replacedRuntime = compileFromAppPlan(
			options(
				function* source() {
					for (let i = 0; i < 70; i++) yield 'x'
				},
				state(
					{
						hasTrace: true,
						traceCount: 1,
						hasAfterHandle: true,
						hasAfterResponse: true,
						hasLifecycleHook: true
					},
					{
						traceHandlers: [
							({ onHandle }: any) =>
								onHandle(({ onStop }: any) =>
									onStop(() => replaced.push('handle'))
								)
						],
						tracePhases: new Set<any>(['handle']),
						traceHandleOn: true
					}
				),
				{
					afterHandle: [() => 'replacement'],
					afterResponse: [() => void replaced.push('cleanup')]
				}
			)
		).runtime
		expect(
			await responseShape(
				replacedRuntime(context(new Request('http://localhost/'))) as any
			)
		).toMatchObject({ body: 'replacement' })
		await Bun.sleep(0)
		expect(replaced).toEqual(['handle', 'cleanup'])

		let unintendedReturn = 0
		const plainRuntime = compileFromAppPlan(
			options(
				() => ({ return: () => unintendedReturn++ }),
				state({
					hasAfterHandle: true,
					hasAfterResponse: true,
					hasLifecycleHook: true
				}),
				{ afterHandle: [() => 'plain'], afterResponse: [() => {}] }
			)
		).runtime
		await responseShape(
			plainRuntime(context(new Request('http://localhost/'))) as any
		)
		expect(unintendedReturn).toBe(0)

		const failed: string[] = []
		const failedRuntime = compileFromAppPlan(
			options(
				function* source() {
					for (let i = 0; i < 70; i++) yield 'x'
				},
				state(
					{
						hasTrace: true,
						traceCount: 1,
						hasAfterHandle: true,
						hasAfterResponse: true,
						hasErrorHook: true,
						hasLifecycleHook: true
					},
					{
						traceHandlers: [
							({ onHandle }: any) =>
								onHandle(({ onStop }: any) =>
									onStop(() => failed.push('handle'))
								)
						],
						tracePhases: new Set<any>(['handle']),
						traceHandleOn: true
					}
				),
				{
					afterHandle: [() => Promise.reject(new Error('after'))],
					error: [() => Promise.reject(new Error('nested'))],
					afterResponse: [() => void failed.push('cleanup')]
				}
			)
		).runtime
		expect(
			await responseShape(
				failedRuntime(context(new Request('http://localhost/'))) as any
			)
		).toMatchObject({ body: 'final:nested' })
		await Bun.sleep(0)
		expect(failed).toEqual(['handle'])

		let cleanup = 0
		const rejectingAdapter = {
			...WebStandardAdapter,
			name: 'RejectingAdapter',
			response: {
				...WebStandardAdapter.response,
				compact: () => Promise.reject(new Error('map'))
			}
		} as any
		const rejectingOptions = {
			...options(
				() => 'ok',
				state({ hasAfterResponse: true, hasLifecycleHook: true }),
				{ afterResponse: [() => cleanup++] }
			),
			adapter: rejectingAdapter
		}
		const rejectingRuntime = compileFromAppPlan(rejectingOptions).runtime
		expect(
			await responseShape(
				rejectingRuntime(context(new Request('http://localhost/'))) as any
			)
		).toMatchObject({ body: 'final:map' })
		await Bun.sleep(0)
		expect(cleanup).toBe(1)
	})

	it('supports response, promise, mount-delegate, cookie, file, and stream values', async () => {
		const cases: Array<[unknown, RouteDescriptor['handlerKind'], string]> = [
			[new Response('static'), 'response', 'static'],
			[Promise.resolve(new Response('promise')), 'promise', 'promise'],
			[
				({ request }: any) =>
					new Response(`mount:${new URL(request.url).pathname}`),
				'function',
				'mount:/'
			]
		]
		for (const [handler, handlerKind, body] of cases) {
			const runtime = compileRouteFromPlan(
				options(
					handler,
					state({
						handlerKind,
						isStaticResponse: handlerKind === 'response'
					})
				)
			)
			expect(
				await responseShape(
					runtime(context(new Request('http://localhost/'))) as any
				)
			).toMatchObject({ status: 200, body })
		}

		const cookieState = state(
			{ responseMode: 'set', contextMode: 'set' },
			{ cookieConfig: compileCookieConfig(undefined, undefined) }
		)
		const cookieRuntime = compileRouteFromPlan(
			options(({ cookie }: any) => cookie.session.value, cookieState)
		)
		expect(
			await responseShape(
				cookieRuntime(
					context(
						new Request('http://localhost/', {
							headers: { cookie: 'session=hello' }
						})
					)
				) as any
			)
		).toMatchObject({ body: 'hello' })

		const fileRuntime = compileRouteFromPlan(
			options(() => new Blob(['abcdef']))
		)
		expect(
			await responseShape(
				fileRuntime(
					context(
						new Request('http://localhost/', {
							headers: { range: 'bytes=1-3' }
						})
					)
				) as any
			)
		).toMatchObject({ status: 206, body: 'bcd' })

		const streamRuntime = compileRouteFromPlan(
			options(function* () {
				yield 'a'
				yield 'b'
			})
		)
		expect(
			await responseShape(
				streamRuntime(context(new Request('http://localhost/'))) as any
			)
		).toMatchObject({ status: 200, body: 'ab' })
	})
})

type AnyFn = (...args: any[]) => any
