import { describe, expect, it } from 'bun:test'
import {
	bindAppPlanAot,
	createAppPlanAotPayload,
	serializeAppPlanAot,
	type AppPlanAotPayload,
	type AppPlanAotValidatorManifest
} from '../../src/compile/app-plan-aot'
import { createAppPlan } from '../../src/compile/app-plan'
import type { WSRoutePlan } from '../../src/ws/runtime'

const opaqueHandler = () => 'opaque-handler-source-must-not-serialize'
const validatorExternal = () => true
const wsMessage = () => undefined

const plan = () =>
	createAppPlan({
		abi: 'test:direct-aot',
		application: {
			fetch: { strictPath: false },
			lifecycle: {}
		},
		runtimeConstants: { notFoundStatus: 404 },
		adapter: {
			target: 'bun',
			capabilities: { websocket: true }
		},
		httpRoutes: [
			{
				method: 'GET',
				path: '/user/:id',
				handlerForm: 'function',
				program: {
					version: 2,
					content: { context: ['params'], sink: 'compact' },
					bindings: [{ role: 'handler', value: opaqueHandler }]
				},
				validators: [
					{
						slot: 'params',
						version: 3,
						content: { kind: 'object' },
						bindings: [
							{
								role: 'paramsValidator',
								value: validatorExternal
							}
						]
					}
				]
			}
		],
		wsRoutes: [
			{
				path: '/chat',
				plan: {} as WSRoutePlan,
				version: 1,
				content: { flags: 1 },
				bindings: [{ role: 'wsMessage', value: wsMessage }]
			}
		]
	})

const sidecars = (live: ReturnType<typeof plan>) => {
	const validator = live.httpRoutes[0]!.validators[0]!
	const validators: AppPlanAotValidatorManifest = {
		GET: {
			'/user/:id': {
				params: {
					identity: validator,
					image: { c: () => () => true }
				}
			}
		}
	}
	const wsRoutes = {
		'/chat': {
			identity: live.wsRoutes[0]!.identity,
			roles: ['message'],
			image: {
				a: ['message'],
				f: () => undefined
			}
		}
	}

	return { validators, wsRoutes }
}

describe('direct AppPlan AOT serializer', () => {
	it('serializes exact programs and layout without opaque values or handlers', () => {
		const live = plan()
		const source = serializeAppPlanAot(live)
		const payload = JSON.parse(source) as AppPlanAotPayload

		expect(payload).toEqual(createAppPlanAotPayload(live))
		expect(payload.fingerprint.httpRoutes[0]!.program).toEqual({
			version: 2,
			content: { context: ['params'], sink: 'compact' },
			bindingIndices: [0]
		})
		expect(payload.fingerprint.bindingLayout).toEqual(live.bindingLayout)
		expect(source).not.toContain('opaque-handler-source-must-not-serialize')
		expect('externalBindings' in payload).toBe(false)
		expect(source).not.toContain('handlers')
	})

	it('exposes live bindings only after exact payload and sidecar validation', () => {
		const live = plan()
		const payload = JSON.parse(serializeAppPlanAot(live)) as AppPlanAotPayload
		const { validators, wsRoutes } = sidecars(live)
		const bound = bindAppPlanAot(payload, live, validators, wsRoutes)

		expect(bound.fingerprint).toBe(live.fingerprint)
		expect(bound.programs).toBe(live.fingerprint.httpRoutes)
		expect(bound.bindingLayout).toBe(live.bindingLayout)
		expect(bound.bindings).toBe(live.externalBindings)
		expect(bound.bindings).toEqual([
			opaqueHandler,
			validatorExternal,
			wsMessage
		])
		expect(bound.validators).not.toBe(validators)
		expect(bound.wsRoutes).not.toBe(wsRoutes)
		expect(bound.wsRoutes['/chat']!.image.a).toEqual(['message'])
		expect(Object.isFrozen(bound.validators)).toBe(true)
		expect(Object.isFrozen(bound.wsRoutes)).toBe(true)

		;(payload.fingerprint.httpRoutes[0] as any).path = '/mutated'
		;(payload.fingerprint.bindingLayout[0] as any).role = 'request'
		;(validators.GET!['/user/:id']!.params!.image as any).c = undefined
		;(wsRoutes['/chat']!.image.a as string[])[0] = 'open'
		expect(bound.programs[0]!.path).toBe('/user/:id')
		expect(bound.bindingLayout[0]!.role).toBe('handler')
		expect(bound.validators.GET!['/user/:id']!.params!.image.c).toBeFunction()
		expect(bound.wsRoutes['/chat']!.image.a).toEqual(['message'])
	})

	it('checks format before fingerprint or sidecar access', () => {
		const live = plan()
		const payload = {
			...createAppPlanAotPayload(live),
			format: -1
		} as unknown as AppPlanAotPayload
		const poisoned = new Proxy(
			{},
			{
				ownKeys() {
					throw new Error('sidecar accessed')
				}
			}
		)

		expect(() => bindAppPlanAot(payload, live, poisoned)).toThrow(
			'Unsupported AppPlan manifest format'
		)
	})

	it('rejects route, program, validator, binding, adapter, and WS mismatches', () => {
		const live = plan()
		const payload = JSON.parse(serializeAppPlanAot(live)) as AppPlanAotPayload
		const { validators, wsRoutes } = sidecars(live)
		const mismatch = (change: (copy: any) => void) => {
			const copy = structuredClone(payload)
			change(copy)
			expect(() => bindAppPlanAot(copy, live, validators, wsRoutes)).toThrow(
				'AppPlan fingerprint mismatch'
			)
		}

		mismatch((copy) => (copy.fingerprint.httpRoutes[0].path = '/other'))
		mismatch(
			(copy) => (copy.fingerprint.httpRoutes[0].program.content.sink = 'set')
		)
		mismatch(
			(copy) =>
				(copy.fingerprint.httpRoutes[0].validators[0].artifact.kind =
					'number')
		)
		mismatch(
			(copy) => (copy.fingerprint.bindingLayout[1].role = 'delegate')
		)
		mismatch((copy) => (copy.fingerprint.adapter.target = 'workerd'))
		mismatch((copy) => (copy.fingerprint.wsRoutes[0].path = '/socket'))
	})

	it('allows omitted opaque images and rejects extra or rebound images', () => {
		const live = plan()
		const payload = createAppPlanAotPayload(live)
		const { validators, wsRoutes } = sidecars(live)

		expect(bindAppPlanAot(payload, live, {}, wsRoutes).validators).toEqual({})
		expect(() =>
			bindAppPlanAot(
				payload,
				live,
				{
					...validators,
					POST: {
						'/extra': {
							body: {
								identity: live.httpRoutes[0]!.validators[0]!,
								image: {}
							}
						}
					}
				},
				wsRoutes
			)
		).toThrow('Validator image layout mismatch')

		const rebound: AppPlanAotValidatorManifest = {
			GET: {
				'/user/:id': {
					params: {
						...validators.GET!['/user/:id']!.params!,
						identity: {
							...validators.GET!['/user/:id']!.params!.identity,
							bindingIndices: []
						}
					}
				}
			}
		}
		expect(() => bindAppPlanAot(payload, live, rebound, wsRoutes)).toThrow(
			'Validator image layout mismatch'
		)

		const staleArtifact: AppPlanAotValidatorManifest = {
			GET: {
				'/user/:id': {
					params: {
						...validators.GET!['/user/:id']!.params!,
						identity: {
							...validators.GET!['/user/:id']!.params!.identity,
							artifact: { kind: 'number' }
						}
					}
				}
			}
		}
		expect(() =>
			bindAppPlanAot(payload, live, staleArtifact, wsRoutes)
		).toThrow('Validator image layout mismatch')
	})

	it('rejects swapped validator path and response-status identities before hydration', () => {
		const live = createAppPlan({
			abi: 'test:direct-aot',
			application: { fetch: {}, lifecycle: {} },
			adapter: { target: 'bun' },
			httpRoutes: [
				{
					method: 'GET',
					path: '/a',
					handlerForm: 'function',
					program: {
						version: 1,
						content: {},
						bindings: [{ role: 'handler', value: opaqueHandler }]
					},
					validators: [
						{
							slot: 'response:200',
							version: 1,
							content: { owner: 'a-200' },
							bindings: [{ role: 'responseValidator', value: validatorExternal }]
						},
						{
							slot: 'response:400',
							version: 1,
							content: { owner: 'a-400' },
							bindings: [{ role: 'responseValidator', value: validatorExternal }]
						}
					]
				},
				{
					method: 'GET',
					path: '/b',
					handlerForm: 'function',
					program: {
						version: 1,
						content: {},
						bindings: [{ role: 'handler', value: opaqueHandler }]
					},
					validators: [
						{
							slot: 'response:200',
							version: 1,
							content: { owner: 'b-200' },
							bindings: [{ role: 'responseValidator', value: validatorExternal }]
						}
					]
				}
			]
		})
		const routeA = live.httpRoutes[0]!
		const routeB = live.httpRoutes[1]!
		let factoryCalls = 0
		const image = { c: () => (factoryCalls++, () => true) }

		const swappedPath: AppPlanAotValidatorManifest = {
			GET: {
				'/a': {
					'response:200': { identity: routeB.validators[0]!, image }
				}
			}
		}
		const swappedStatus: AppPlanAotValidatorManifest = {
			GET: {
				'/a': {
					'response:200': { identity: routeA.validators[1]!, image }
				}
			}
		}

		expect(() =>
			bindAppPlanAot(createAppPlanAotPayload(live), live, swappedPath)
		).toThrow('Validator image layout mismatch')
		expect(() =>
			bindAppPlanAot(createAppPlanAotPayload(live), live, swappedStatus)
		).toThrow('Validator image layout mismatch')
		expect(factoryCalls).toBe(0)
	})

	it('keeps WS images separate and rejects path, binding, and role drift', () => {
		const live = plan()
		const payload = createAppPlanAotPayload(live)
		const { validators, wsRoutes } = sidecars(live)

		expect(bindAppPlanAot(payload, live, validators, {}).wsRoutes).toEqual({})
		expect(() =>
			bindAppPlanAot(payload, live, validators, {
				'/other': wsRoutes['/chat']!
			})
		).toThrow('WebSocket image path mismatch')
		expect(() =>
			bindAppPlanAot(payload, live, validators, {
				'/chat': {
					...wsRoutes['/chat']!,
					identity: { ...wsRoutes['/chat']!.identity, bindingIndices: [] }
				}
			})
		).toThrow('WebSocket image identity mismatch')
		expect(() =>
			bindAppPlanAot(payload, live, validators, {
				'/chat': {
					...wsRoutes['/chat']!,
					image: { ...wsRoutes['/chat']!.image, a: ['open'] }
				}
			})
		).toThrow('WebSocket image role mismatch')
		expect(() =>
			bindAppPlanAot(payload, live, validators, {
				'/chat': {
					...wsRoutes['/chat']!,
					identity: {
						...wsRoutes['/chat']!.identity,
						content: { flags: 2 }
					}
				}
			})
		).toThrow('WebSocket image identity mismatch')
	})

	it('rejects stale generated identities sharing one app-local ProgramId', () => {
		const live = plan()
		const current = sidecars(live)
		const stale = createAppPlan({
			...{
				abi: 'test:direct-aot',
				programId: live.programId,
				application: {
					fetch: { strictPath: false },
					lifecycle: {}
				},
				runtimeConstants: { notFoundStatus: 404 },
				adapter: { target: 'bun', capabilities: { websocket: true } }
			},
			httpRoutes: [
				{
					method: 'GET',
					path: '/user/:id',
					handlerForm: 'function',
					program: {
						version: 2,
						content: { context: ['params'], sink: 'compact' },
						bindings: [{ role: 'handler', value: opaqueHandler }]
					},
					validators: [
						{
							slot: 'params',
							version: 3,
							content: { kind: 'number' },
							bindings: [
								{ role: 'paramsValidator', value: validatorExternal }
							]
						}
					]
				}
			],
			wsRoutes: [
				{
					path: '/chat',
					plan: {} as WSRoutePlan,
					version: 1,
					content: { flags: 2 },
					bindings: [{ role: 'wsMessage', value: wsMessage }]
				}
			]
		})
		const staleValidators: AppPlanAotValidatorManifest = {
			GET: {
				'/user/:id': {
					params: {
						identity: stale.httpRoutes[0]!.validators[0]!,
						image: { c: () => () => false }
					}
				}
			}
		}
		const staleWSRoutes = {
			'/chat': {
				identity: stale.wsRoutes[0]!.identity,
				roles: ['message'],
				image: {
					a: ['message'],
					f: () => 'stale-websocket-image'
				}
			}
		}
		const payload = createAppPlanAotPayload(live)

		expect(stale.programId).toBe(live.programId)
		expect(() =>
			bindAppPlanAot(
				payload,
				live,
				staleValidators,
				current.wsRoutes
			)
		).toThrow('Validator image layout mismatch')
		expect(() =>
			bindAppPlanAot(
				payload,
				live,
				current.validators,
				staleWSRoutes
			)
		).toThrow('WebSocket image identity mismatch')
	})
})
