import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	createAppPlanAotPayload,
	type AppPlanAotValidatorManifest
} from '../../src/compile/app-plan-aot'
// importing `aot-capture` also installs the build-only capture impl (side effect)
import '../../src/compile/aot-capture'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { materialise } from '../aot/_manifest'
import { buildFrozenWSRoute } from '../../src/ws/runtime'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

// Frozen WebSocket builds capture and reuse body, query, and response validators.

beforeEach(() => {
	Compiled.clear()
	Validator.clear()
})
afterEach(() => {
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

// Echo decoded types so frozen and JIT validators can be compared.
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

// `.ws()` returns AddWSRoute, so builders use the concrete value through `any`.
const captureManifest = async (builder: () => any) => {
	const artifacts = await captureArtifacts(builder(), { register: true })
	const plan = artifacts.appPlan!
	const materialised = materialise(artifacts.validators)
	const validators: AppPlanAotValidatorManifest = {}
	for (const route of plan.wsRoutes) {
		const byPath = (validators.WS ??= {})
		const bySlot = (byPath[route.path] ??= {})
		for (const identity of route.validators) {
			const image = materialised.WS?.[route.path]?.[identity.slot]
			if (image) bySlot[identity.slot] = { identity, image }
		}
	}

	return { artifacts, plan, validators }
}

const registerManifest = async (builder: () => any) => {
	const captured = await captureManifest(builder)
	Compiled.clear()
	Compiled.register({
		bf: 1,
		fingerprint: captured.artifacts.fingerprint,
		appPlan: {
			payload: createAppPlanAotPayload(captured.plan),
			validators: captured.validators,
			wsRoutes: {}
		}
	})
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
	it('captures exact WS validator identities in the direct AppPlan lane', async () => {
		const { artifacts, plan } = await captureManifest(build)
		const captured = artifacts.validators

		const ws = captured.filter((v) => v.method === 'WS' && v.path === '/ws')
		const slots = ws.map((v) => String(v.slot))

		expect(ws.length).toBeGreaterThan(0)
		expect(slots).toContain('body')
		expect(slots).toContain('query')
		expect(slots.some((s) => s.startsWith('response'))).toBe(true)
		expect(plan.wsRoutes[0]!.validators.map((validator) => validator.slot)).toEqual(
			['body', 'query', 'response:200']
		)
		expect(artifacts.source).toContain(
			'appPlan: { payload: appPlanPayload, validators: appPlanValidators, wsRoutes: appPlanWSRoutes }'
		)
		expect(artifacts.source).not.toMatch(/export const handlers|const _h\d+/)
	})

	it('reuses direct WS validator images without retaining the legacy cache', async () => {
		const captured = await registerManifest(build)
		Validator.clear()
		let imageFactoryCalls = 0
		for (const image of Object.values(captured.validators.WS!['/ws']!)) {
			if (!image?.image.cm) continue
			const original = image.image.cm
			image.image.cm = (...args) => {
				imageFactoryCalls++
				return original(...args)
			}
		}

		const app = build()
		app.compile()

		expect(imageFactoryCalls).toBe(3)
		expect(Compiled.pendingAppPlan()).toBeUndefined()
	})

	it('hydrates each direct WS validator once when a compact WS image is also present', async () => {
		const captured = await captureManifest(build)
		const route = captured.artifacts.wsRoutes.find(
			(entry) => entry.path === '/ws' && 'source' in entry
		)
		if (!route || !('source' in route))
			throw new Error('expected a captured WS image')

		const compactFactory = new Function(
			'buildFrozenWSRoute',
			`return ${route.source}`
		)(buildFrozenWSRoute) as (...args: unknown[]) => unknown
		let compactFactoryCalls = 0
		let validatorFactoryCalls = 0
		for (const entry of Object.values(captured.validators.WS!['/ws']!)) {
			if (!entry?.image.cm) continue
			const original = entry.image.cm
			entry.image.cm = (...args) => {
				validatorFactoryCalls++
				return original(...args)
			}
		}

		Compiled.clear()
		Compiled.register({
			bf: 1,
			fingerprint: captured.artifacts.fingerprint,
			appPlan: {
				payload: createAppPlanAotPayload(captured.plan),
				validators: captured.validators,
				wsRoutes: {
					'/ws': {
						identity: captured.plan.wsRoutes[0]!.identity,
						roles: route.roles,
						image: {
							a: route.roles,
							f: (...args: unknown[]) => {
								compactFactoryCalls++
								return compactFactory(...args)
							}
						}
					}
				}
			}
		})

		build().compile()

		expect(validatorFactoryCalls).toBe(3)
		expect(compactFactoryCalls).toBe(0)
		expect(Compiled.pendingAppPlan()).toBeUndefined()
	})

	it('frozen and JIT routes validate and decode messages identically', async () => {
		const VALID = JSON.stringify({
			when: '2020-01-01T00:00:00.000Z',
			n: '42'
		})
		const INVALID = JSON.stringify({ when: 'not-a-date', n: 'abc' })

		await registerManifest(buildCodec)
		Validator.clear()

		const frozenApp = buildCodec().listen(0)
		expect(Compiled.pendingAppPlan()).toBeUndefined()
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
