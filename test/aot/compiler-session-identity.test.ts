import '../../src/compile/aot-capture'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { Compiled } from '../../src/compile/aot'
import { createAppPlan } from '../../src/compile/app-plan'
import {
	createAppPlanAotPayload,
	prepareAppPlanAotPlanningInputs,
	type AppPlanAotValidatorManifest
} from '../../src/compile/app-plan-aot'
import {
	abortCapture,
	getCompilerSessionDiagnostics
} from '../../src/compile/aot-capture'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { Validator } from '../../src/validator'
import { buildFrozenWSRoute } from '../../src/ws/runtime'
import { post } from '../utils'
import { materialise } from './_manifest'

const buildA = () =>
	new Elysia({ precompile: true }).post(
		'/x',
		{ body: t.Object({ a: t.String() }) },
		({ body }) => body
	)

const register = async () => {
	const capturedApp = buildA()
	const artifacts = await captureArtifacts(capturedApp, { register: true })
	const validators = materialise(artifacts.validators)
	const appPlan = artifacts.appPlan!
	const identity = appPlan.httpRoutes[0]!.validators[0]!
	const appPlanValidators: AppPlanAotValidatorManifest = {
		POST: {
			'/x': {
				body: {
					identity,
					image: validators.POST!['/x']!.body!
				}
			}
		}
	}
	const appPlanRegistration = {
		payload: createAppPlanAotPayload(appPlan),
		validators: appPlanValidators,
		wsRoutes: {}
	}

	Compiled.clear()
	Compiled.register({
		bf: 1,
		fingerprint: artifacts.fingerprint,
		appPlan: appPlanRegistration
	})

	return { artifacts, validators, appPlanRegistration }
}

beforeEach(() => {
	abortCapture()
	Compiled.clear()
	Validator.clear()
})

afterEach(() => {
	abortCapture()
	Compiled.clear()
	Validator.clear()
})

describe('AOT manifest ownership and compiler sessions', () => {
	it('does not inspect Symbol.toStringTag while planning a WS handler', () => {
		let reads = 0
		const handler = new Proxy(function message() {}, {
			get(target, key, receiver) {
				if (key === Symbol.toStringTag) {
					reads++
					throw new Error('Symbol.toStringTag must stay inert')
				}
				return Reflect.get(target, key, receiver)
			}
		})

		expect(
			() => void new Elysia().ws('/ws', { message: handler }).fetch
		).not.toThrow()
		expect(reads).toBe(0)
	})

	it('emits captured validators with their owning AppPlan identity', async () => {
		const app = buildA()
		const handler = () => undefined
		const appPlan = createAppPlan({
			programId: app['~programId'],
			application: {
				fetch: {},
				lifecycle: {}
			},
			adapter: { target: 'bun' },
			httpRoutes: [
				{
					method: 'POST',
					path: '/x',
					handlerForm: 'function',
					program: {
						version: 1,
						content: {},
						bindings: [{ role: 'handler', value: handler }]
					},
					validators: [
						{
							slot: 'body',
							version: 1,
							content: { kind: 'object' },
							bindings: [{ role: 'bodyValidator', value: {} }]
						}
					]
				}
			]
		})
		const artifacts = await captureArtifacts(app, { appPlan })

		expect(artifacts.source).toContain('export const appPlanValidators')
		expect(artifacts.source).toContain('"artifact":{"kind":"object"}')
	})

	it('only the first compatible app claims a registered manifest', async () => {
		const { artifacts } = await register()
		expect(artifacts.source).toContain(
			'appPlan: { payload: appPlanPayload, validators: appPlanValidators, wsRoutes: appPlanWSRoutes }'
		)
		expect(artifacts.source).not.toMatch(/export const handlers|const _h\d+/)

		const appA = buildA()
		const a = await appA.handle(post('/x', { a: 'ok' }))
		expect(a.status).toBe(200)
		expect(Compiled.pendingAppPlan()).toBeUndefined()

		const appB = new Elysia({ precompile: true }).post(
			'/x',
			{ body: t.Object({ b: t.Number() }) },
			({ body }) => body
		)
		expect((await appB.handle(post('/x', { b: 1 }))).status).toBe(200)
		expect((await appB.handle(post('/x', { a: 'wrong' }))).status).toBe(422)

		const appC = buildA()
		const c = await appC.handle(post('/x', { a: 'ok' }))
		expect(c.status).toBe(a.status)
		expect(await c.text()).toBe(await a.text())
	})

	it('rejects a manifest built by an incompatible framework ABI', async () => {
		const { artifacts, appPlanRegistration } = await register()

		Compiled.clear()
		Compiled.register({
			bf: 1,
			fingerprint: {
				...artifacts.fingerprint,
				abi: 'from-the-future:99'
			},
			appPlan: {
				...appPlanRegistration,
				payload: {
					...appPlanRegistration.payload,
					fingerprint: {
						...appPlanRegistration.payload.fingerprint,
						abi: 'from-the-future:99'
					}
				}
			}
		})

		expect(() => void buildA().fetch).toThrow('AppPlan fingerprint mismatch')
	})

	it('rejects old manifest formats and planRebuilder layouts', async () => {
		const { artifacts, appPlanRegistration } = await register()
		Compiled.clear()

		expect(() =>
			Compiled.register({
				bf: 1,
				fingerprint: artifacts.fingerprint,
				appPlan: {
					...appPlanRegistration,
					payload: {
						...appPlanRegistration.payload,
						format: 6
					}
				}
			} as any)
		).toThrow('Unsupported AppPlan manifest format: 6')
		expect(Compiled.pendingAppPlan()).toBeUndefined()

		expect(() =>
			Compiled.register({
				bf: 1,
				fingerprint: artifacts.fingerprint,
				planRebuilder: () => undefined,
				appPlan: appPlanRegistration
			} as any)
		).toThrow('legacy planRebuilder layout was removed')
		expect(Compiled.pendingAppPlan()).toBeUndefined()
	})

	it('claims the immutable AppPlan snapshot prepared before mutation', async () => {
		const { artifacts, appPlanRegistration } = await register()
		const payload = structuredClone(appPlanRegistration.payload)
		const registration = {
			bf: 1 as const,
			fingerprint: artifacts.fingerprint,
			appPlan: { ...appPlanRegistration, payload }
		}
		Compiled.clear()
		Compiled.register(registration)

		const planning = prepareAppPlanAotPlanningInputs()
		if (!planning) throw new Error('expected AppPlan planning inputs')
		;(payload.fingerprint.httpRoutes[0] as any).path = '/mutated'

		const claim = planning.claim(artifacts.appPlan!)
		expect(claim.image.fingerprint).toBe(artifacts.appPlan!.fingerprint)
		expect(Compiled.pendingAppPlan()).toBe(registration)
		claim.commit()
		expect(Compiled.pendingAppPlan()).toBeUndefined()
	})

	it('rejects a stale validator AppPlan before publication', async () => {
		await register()

		const other = new Elysia({ precompile: true }).post(
			'/x',
			{ body: t.Object({ b: t.Number() }) },
			({ body }) => body
		)
		expect(() => void other.fetch).toThrow('AppPlan fingerprint mismatch')
		expect(other['~generation']).toBeUndefined()
	})

	it('validates the whole AppPlan before invoking frozen factories', async () => {
		const capturedApp = new Elysia({ precompile: true }).post(
			'/x',
			{ body: t.String() },
			({ body }) => body
		)
		const artifacts = await captureArtifacts(capturedApp, { register: true })
		const validators = materialise(artifacts.validators)
		const identity = artifacts.appPlan!.httpRoutes[0]!.validators[0]!
		const frozen = validators.POST!['/x']!.body!
		const factory = frozen.cm
		if (!factory) throw new Error('expected a frozen validator factory')
		let factoryCalls = 0
		frozen.cm = (...args) => {
			factoryCalls++
			return factory(...args)
		}
		const registration = {
			bf: 1 as const,
			fingerprint: artifacts.fingerprint,
			appPlan: {
				payload: createAppPlanAotPayload(artifacts.appPlan!),
				validators: {
					POST: {
						'/x': { body: { identity, image: frozen } }
					}
				},
				wsRoutes: {}
			}
		}
		Compiled.clear()
		Compiled.register(registration)

		const stale = new Elysia({ precompile: true }).post(
			'/x',
			{ body: t.Number() },
			({ body }) => body
		)
		expect(() => void stale.fetch).toThrow('AppPlan fingerprint mismatch')
		expect(factoryCalls).toBe(0)
		expect(stale['~generation']).toBeUndefined()
		expect(Compiled.pendingAppPlan()).toBe(registration)
	})

	it('hydrates only an exactly matching WS image', async () => {
		const capturedApp = new Elysia({ precompile: true }).ws('/ws', {
			message: () => {}
		})
		const captured = await captureArtifacts(capturedApp)
		const route = captured.wsRoutes.find(
			(entry) => entry.path === '/ws' && 'source' in entry
		)
		if (!route || !('source' in route))
			throw new Error('expected a captured WS image')
		const factory = new Function(
			'buildFrozenWSRoute',
			`return ${route.source}`
		)(buildFrozenWSRoute) as (...args: unknown[]) => unknown
		const wsIdentity = captured.appPlan!.wsRoutes[0]!.identity
		const registerWS = (image: { a: string[]; f: (...args: any[]) => any }) =>
			Compiled.register({
				bf: 1,
				fingerprint: captured.fingerprint,
				appPlan: {
					payload: createAppPlanAotPayload(captured.appPlan!),
					validators: {},
					wsRoutes: {
						'/ws': {
							identity: wsIdentity,
							roles: route.roles,
							image
						}
					}
				}
			})

		let matchingHydrated = false
		registerWS({
			a: route.roles,
			f: (...args) => {
				const result = factory(...args)
				matchingHydrated = result !== undefined
				return result
			}
		})
		void new Elysia({ precompile: true }).ws('/ws', {
			message: () => {}
		}).fetch
		expect(matchingHydrated).toBe(true)

		registerWS({ a: route.roles, f: () => undefined })
		const failed = new Elysia({ precompile: true }).ws('/ws', {
			message: () => {}
		})
		expect(() => void failed.fetch).toThrow('Failed to bind AppPlan WebSocket')
		expect(failed['~generation']).toBeUndefined()
		expect(Compiled.pendingAppPlan()).toBeDefined()

		let roleFactoryCalls = 0
		registerWS({
			a: ['open'],
			f: (...args) => {
				roleFactoryCalls++
				return factory(...args)
			}
		})
		expect(
			() =>
				void new Elysia({ precompile: true }).ws('/ws', {
					message: () => {}
				}).fetch
		).toThrow('WebSocket image role mismatch')
		expect(roleFactoryCalls).toBe(0)

		let semanticFactoryCalls = 0
		let hydrated = true
		registerWS({
			a: route.roles,
			f: (...args) => {
				semanticFactoryCalls++
				const result = factory(...args)
				hydrated = result !== undefined
				return result
			}
		})
		expect(
			() =>
				void new Elysia({ precompile: true }).ws('/ws', {
					async message(ws) {
						ws.send('different semantics')
					}
				}).fetch
		).toThrow('AppPlan fingerprint mismatch')
		expect(semanticFactoryCalls).toBe(0)
		expect(hydrated).toBe(true)
	})

	it('rejects later routes instead of invoking legacy HTTP factories', async () => {
		await register()

		const app = buildA().get('/late', () => 'late')
		expect(() => void app.fetch).toThrow('AppPlan fingerprint mismatch')
		expect(app['~generation']).toBeUndefined()
	})

	it('leaves a registered manifest available after compiling a routeless app', async () => {
		await register()

		void new Elysia({ precompile: true }).fetch

		const app = buildA()
		const response = await app.handle(post('/x', { a: 'ok' }))
		expect(response.status).toBe(200)
	})

	it('ignores a stale registration after an app claims its manifest', async () => {
		const stale = await captureArtifacts(
			new Elysia({ precompile: true }).get('/late', () => 'stale')
		)
		await register()

		const app = buildA()
		expect((await app.handle(post('/x', { a: 'ok' }))).status).toBe(200)

		// a registration arriving after the claim must never rebind the app
		Compiled.register({
			bf: 1,
			fingerprint: stale.fingerprint,
			appPlan: {
				payload: createAppPlanAotPayload(stale.appPlan!),
				validators: {},
				wsRoutes: {}
			}
		})

		const response = await app.handle(post('/x', { a: 'still-live' }))
		expect(await response.json()).toEqual({ a: 'still-live' })
	})

	it('releases sessions after successful and failed builds', () => {
		const good = new Elysia({ precompile: true }).get('/ok', () => 'ok')
		void good.fetch
		expect(good['~compilerSession']).toBeUndefined()
		expect(getCompilerSessionDiagnostics()).toEqual({
			active: false,
			appAttached: false,
			validators: 0,
			wsRoutes: 0,
			sucrose: 0
		})

		const bad = new Elysia({ precompile: true }).post(
			'/bad',
			{ body: 'missing' as any },
			() => 'bad'
		)
		expect(() => void bad.fetch).toThrow('Unknown model reference')
		expect(bad['~compilerSession']).toBeUndefined()
		expect(getCompilerSessionDiagnostics().active).toBe(false)
	})
})
