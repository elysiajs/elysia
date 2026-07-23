import { describe, expect, it } from 'bun:test'
import {
	APP_PLAN_VERSION,
	appPlanFingerprintsEqual,
	assertAppPlanPublicationIdentity,
	createAppPlan,
	type AppPlanInput,
	type HttpRoutePlanInput
} from '../../src/compile/app-plan'
import type { WSRoutePlan } from '../../src/ws/runtime'
import { WebStandardAdapter } from '../../src/adapter/web-standard'
import { balancedAdapterPlan } from '../../src/compile/handler/balanced-program'

const handler = () => 'ok'
const adapterPlan = balancedAdapterPlan(WebStandardAdapter)
const route = (
	path: string,
	override: Partial<HttpRoutePlanInput> = {}
): HttpRoutePlanInput => ({
	method: 'GET',
	path,
	handlerForm: 'function',
	program: {
		version: 1,
		content: { sink: 'compact' },
		bindings: [{ role: 'handler', value: handler }]
	},
	...override
})
const input = (
	httpRoutes: readonly HttpRoutePlanInput[] = [route('/')]
): AppPlanInput => ({
	abi: 'test:1',
	application: {
		fetch: { strictPath: false },
		lifecycle: { error: false },
		bindings: adapterPlan.bindings
	},
	runtimeConstants: { notFoundStatus: 404 },
	adapter: adapterPlan.adapter,
	httpRoutes
})

describe('AppPlan', () => {
	it('preserves an empty root path', () => {
		expect(createAppPlan(input([route('')])).httpRoutes[0]!.path).toBe('')
	})

	it('accepts pre-resolved winners with declared coverage and dense IDs', () => {
		const plan = createAppPlan(
			{
				...input([
				route('/b'),
				route('/a'),
				route('/c'),
				route('/c', { method: 'POST' }),
				route('/:id')
				]),
				declaredRoutes: { http: 6, ws: 0 }
			}
		)

		expect(
			plan.httpRoutes.map(({ id, nodeId, method, path }) => [
				id,
				nodeId,
				method,
				path
			])
		).toEqual([
			[0, 1, 'GET', '/b'],
			[1, 2, 'GET', '/a'],
			[2, 3, 'GET', '/c'],
			[3, 4, 'POST', '/c'],
			[4, 5, 'GET', '/:id']
		])
		expect(plan.coverage).toMatchObject({
			declaredHttpRoutes: 6,
			winningHttpRoutes: 5,
			shadowedHttpRoutes: 1,
			plannedHttpRoutes: 5
		})
		expect('coverage' in plan.fingerprint).toBe(false)
	})

	it('shares equal immutable program content without sharing route bindings', () => {
		const plan = createAppPlan(
			input([
				route('/a'),
				route('/b'),
				route('/c', {
					program: {
						version: 2,
						content: { sink: 'compact' },
						bindings: [{ role: 'handler', value: handler }]
					}
				})
			])
		)

		expect(plan.httpRoutes[0]!.program.content).toBe(
			plan.httpRoutes[1]!.program.content
		)
		expect(plan.httpRoutes[0]!.program.content).not.toBe(
			plan.httpRoutes[2]!.program.content
		)
		expect(plan.httpRoutes[0]!.program.bindingIndices).not.toBe(
			plan.httpRoutes[1]!.program.bindingIndices
		)
	})

	it('owns exact binding layout, validator slots, and external values', () => {
		const external = () => true
		const before = () => 'before'
		const after = () => 'after'
		const plan = createAppPlan(
			input([
					route('/', {
					lifecycle: [
						{
							phase: 'beforeHandle',
							bindings: [
								{ role: 'beforeHandle', value: before },
								{ role: 'beforeHandle', value: after }
							]
						}
					],
					validators: [
						{
							slot: 'query',
							version: 2,
							content: { kind: 'object' },
							bindings: [{ role: 'queryValidator', value: external }]
						}
					]
				})
			])
		)

		expect(plan.bindingLayout).toEqual([
			{ nodeId: 0, role: 'adapterParse', ordinal: 0 },
			{ nodeId: 0, role: 'adapterMap', ordinal: 0 },
			{ nodeId: 0, role: 'adapterCompact', ordinal: 0 },
			{ nodeId: 2, role: 'beforeHandle', ordinal: 0 },
			{ nodeId: 3, role: 'beforeHandle', ordinal: 0 },
			{ nodeId: 1, role: 'handler', ordinal: 0 },
			{ nodeId: 1, role: 'queryValidator', ordinal: 0 }
		])
		expect(plan.application.bindingIndices).toEqual([0, 1, 2])
		expect(plan.httpRoutes[0]!.bindingIndices).toEqual([])
		expect(plan.httpRoutes[0]!.lifecycle).toEqual([
			{ phase: 'beforeHandle', segmentId: 1, start: 0, end: 2 }
		])
		expect(plan.httpRoutes[0]!.program.bindingIndices).toEqual([5])
		expect(plan.httpRoutes[0]!.validators).toEqual([
			{
				slot: 'query',
				version: 2,
				artifact: { kind: 'object' },
				bindingIndices: [6]
			}
		])
		expect(plan.externalBindings.slice(3)).toEqual([
			before,
			after,
			handler,
			external
		])
	})

	it('keeps opaque WS plans separate while fingerprinting their identities', () => {
		const first = {} as WSRoutePlan
		const winner = {} as WSRoutePlan
		const plan = createAppPlan({
			...input([]),
			wsRoutes: [
				{
					path: '/other',
					plan: first,
					version: 1,
					content: { mode: 'other' }
				},
				{ path: '/ws', plan: winner, version: 2, content: { mode: 'new' } }
			],
			declaredRoutes: { http: 0, ws: 3 }
		})

		expect(plan.wsRoutes.map(({ path }) => path)).toEqual(['/other', '/ws'])
		expect(plan.wsRoutes[1]!.plan).toBe(winner)
		expect(plan.fingerprint.wsRoutes[1]).toEqual({
			path: '/ws',
			identity: { version: 2, content: { mode: 'new' }, bindingIndices: [] },
			validators: []
		})
		expect(plan.coverage).toMatchObject({
			declaredWSRoutes: 3,
			winningWSRoutes: 2,
			shadowedWSRoutes: 1
		})
	})

	it('produces identical live/AOT fingerprints from equivalent inputs', () => {
		const make = (reverse: boolean) =>
			createAppPlan({
				...input(),
				runtimeConstants: reverse ? { b: 2, a: 1 } : { a: 1, b: 2 },
				adapter: {
					target: 'bun',
					capabilities: reverse
						? { websocket: true, defaultHeaders: true }
						: { defaultHeaders: true, websocket: true }
				},
				httpRoutes: [
					route('/', {
						program: {
							version: 1,
							content: reverse ? { z: 2, a: 1 } : { a: 1, z: 2 },
							bindings: [{ role: 'handler', value: () => reverse }]
						},
						validators: reverse
							? [
								{
									slot: 'query',
									version: 1,
									content: {},
									bindings: [{ role: 'queryValidator', value: {} }]
								},
								{
									slot: 'body',
									version: 1,
									content: {},
									bindings: [{ role: 'bodyValidator', value: {} }]
								}
							]
							: [
								{
									slot: 'body',
									version: 1,
									content: {},
									bindings: [{ role: 'bodyValidator', value: {} }]
								},
								{
									slot: 'query',
									version: 1,
									content: {},
									bindings: [{ role: 'queryValidator', value: {} }]
								}
							]
					})
				]
			})
		const live = make(false)
		const aot = make(true)

		expect(appPlanFingerprintsEqual(live.fingerprint, aot.fingerprint)).toBe(
			true
		)
		expect(() =>
			assertAppPlanPublicationIdentity(live, aot.fingerprint)
		).not.toThrow()
	})

	it('compares every required identity dimension exactly', () => {
		const base = createAppPlan(input())
		const variants = [
			createAppPlan({ ...input(), abi: 'test:2' }),
			createAppPlan({
				...input(),
				application: { ...input().application, fetch: { strictPath: true } }
			}),
			createAppPlan({ ...input(), runtimeConstants: { notFoundStatus: 500 } }),
			createAppPlan({
				...input(),
				adapter: { ...adapterPlan.adapter, target: 'node' }
			}),
			createAppPlan(input([route('/changed')])),
			createAppPlan(
				input([
					route('/', {
						program: {
							version: 2,
							content: { sink: 'compact' },
							bindings: [{ role: 'handler', value: handler }]
						}
					})
				])
			),
			createAppPlan(
				input([
					route('/', {
						validators: [
							{
								slot: 'body',
								version: 1,
								content: { kind: 'string' },
								bindings: [{ role: 'bodyValidator', value: {} }]
							}
						]
					})
				])
			),
			createAppPlan(
				input([
					route('/', {
						lifecycle: [
							{
								phase: 'beforeHandle',
								bindings: [{ role: 'beforeHandle', value: handler }]
							}
						]
					})
				])
			)
		]

		for (const variant of variants)
			expect(
				appPlanFingerprintsEqual(base.fingerprint, variant.fingerprint)
			).toBe(false)
		expect(() => createAppPlan(input([route('/'), route('/')]))).toThrow(
			'pre-resolved winners'
		)
	})

	it('freezes compiler identity without freezing opaque values', () => {
		const content = { nested: { sink: 'compact' } }
		const external = { mutable: true }
		const plan = createAppPlan(
			input([
				route('/', {
					program: {
						version: 1,
						content,
						bindings: [{ role: 'handler', value: external }]
					}
				})
			])
		)

		content.nested.sink = 'changed'
		expect((plan.httpRoutes[0]!.program.content as any).nested.sink).toBe(
			'compact'
		)
		expect(Object.isFrozen(plan.fingerprint)).toBe(true)
		expect(Object.isFrozen(plan.httpRoutes[0]!.program.content)).toBe(true)
		expect(Object.isFrozen(external)).toBe(false)
	})

	it('rejects invalid versions, slots, bindings, and identity data', () => {
		const response = createAppPlan(
			input([
				route('/', {
					handlerForm: 'response',
					program: {
						version: 1,
						content: {},
						bindings: [{ role: 'response', value: new Response() }]
					}
				})
			])
		)
		expect(response.httpRoutes[0]!.handlerForm).toBe('response')
		expect(() =>
			createAppPlan(
				input([
					route('/', {
						program: {
							version: 0,
							content: {},
							bindings: [{ role: 'handler', value: handler }]
						}
					})
				])
			)
		).toThrow('positive integer')
		expect(() =>
			createAppPlan(
				input([
					route('/', {
						program: {
							version: 1,
							content: undefined,
							bindings: [{ role: 'handler', value: handler }]
						}
					})
				])
			)
		).toThrow('not serializable')
		expect(() =>
			createAppPlan(
				input([
					route('/', {
						validators: [
							{
								slot: 'body',
								version: 1,
								content: {},
								bindings: [{ role: 'bodyValidator', value: {} }]
							},
							{
								slot: 'body',
								version: 1,
								content: {},
								bindings: [{ role: 'bodyValidator', value: {} }]
							}
						]
					})
				])
			)
		).toThrow('invalid validator slot')
		expect(() =>
			createAppPlan(
				input([
					route('/', {
						bindings: [{ role: '' as any, value: handler }]
					})
				])
			)
		).toThrow('binding role')
		expect(() =>
			createAppPlan({
				...input(),
				application: {
					fetch: {},
					lifecycle: {},
					bindings: [
						{ role: 'adapterMap', value: handler },
						{ role: 'request', value: handler }
					]
				}
			})
		).toThrow('application binding order')
	})

	it('rejects version, index, and binding mismatches before publication', () => {
		const live = createAppPlan(input())
		const mismatches = [
			{ ...live.fingerprint, planVersion: 3 },
			{
				...live.fingerprint,
				httpRoutes: [
					{
						...live.fingerprint.httpRoutes[0]!,
						program: {
							...live.fingerprint.httpRoutes[0]!.program,
							bindingIndices: [99]
						}
					}
				]
			},
			{
				...live.fingerprint,
				bindingLayout: [
					{ ...live.fingerprint.bindingLayout[0]!, role: 'wrong' },
					...live.fingerprint.bindingLayout.slice(1)
				]
			}
		]

		for (const mismatch of mismatches)
			expect(() =>
				assertAppPlanPublicationIdentity(live, mismatch as any)
			).toThrow()
		expect(live.version).toBe(APP_PLAN_VERSION)
	})
})
