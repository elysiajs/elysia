/** Runs captured validators with the TypeBox bridge deliberately unwired. */
import { readFileSync } from 'node:fs'
import { validationPlan } from '../../../src/experimental/validation-plan'

import { Compiled, type CapturedValidator } from '../../../src/compile/aot'
import type {
	AppPlanAotPayload,
	AppPlanAotValidatorImage
} from '../../../src/compile/app-plan-aot'
import { reconstructValidator } from '../../../src/compile/handler/reconstruct'
import { buildFrozenRouteValidator } from '../../../src/compile/handler/frozen-validator'
import { hasTypes, isTypeboxInitialized } from '../../../src/type/bridge'
import { claimManifest, materialise, registerManifest } from '../_manifest'

const out = (tag: string, data: unknown) =>
	console.log(tag, JSON.stringify(data))

// The bridge must remain unwired for this process to isolate frozen reconstruction.
try {
	hasTypes([], { '~kind': 'Object' } as any)
	out('BRIDGE', 'wired')
	process.exit(2)
} catch {
	out('BRIDGE', 'unwired')
}
out('READY', isTypeboxInitialized())

const payload = JSON.parse(readFileSync(process.env.PAYLOAD!, 'utf8')) as {
	captured: CapturedValidator[]
	schema: unknown
	cases: unknown[]
	method: string
	path: string
	slot?: 'body' | 'query'
	registration?: {
		fingerprint: Parameters<typeof Compiled.register>[0]['fingerprint']
		payload: AppPlanAotPayload
		identity: AppPlanAotValidatorImage['identity']
	}
}

const slot = payload.slot ?? 'body'
let routeValidatorTouched = false
const schema =
	process.env.USE_RECONSTRUCT_VALIDATOR === '1' ||
	process.env.USE_WS_BUILD === '1'
		? new Proxy(payload.schema as object, {
				has(target, key) {
					if (key === '~kind') routeValidatorTouched = true
					return Reflect.has(target, key)
				}
			})
		: payload.schema
const hook = { [slot]: schema } as any

const manifest = { validators: materialise(payload.captured) }
if (process.env.USE_WS_BUILD === '1') {
	if (!payload.registration)
		throw new Error('missing direct AppPlan registration')
	Compiled.register({
		bf: 1,
		fingerprint: payload.registration.fingerprint,
		appPlan: {
			payload: payload.registration.payload,
			validators: {
				WS: {
					[payload.path]: {
						[slot]: {
							identity: payload.registration.identity,
							image: manifest.validators.WS![payload.path]![slot]!
						}
					}
				}
			},
			wsRoutes: {}
		}
	})
	const { Elysia } = await import('../../../src/base')
	out('READY_BEFORE_BUILD', isTypeboxInitialized())
	const app = new Elysia().ws(payload.path, {
		body: schema as any,
		message() {}
	})
	routeValidatorTouched = false
	app.compile()
	out('RESULT', { reconstructed: true, routeValidatorTouched })
	process.exit(0)
}

const claimed = claimManifest(manifest)
const frozenSlots = claimed.validators[payload.method]![payload.path]!
const root = {
	...claimed,
	'~config': {
		experimental: slot === 'query' ? { validationPlan } : undefined
	},
	'~ext': {}
} as any

// A live RouteValidator must fail here, proving success uses frozen reconstruction.
if (process.env.USE_LIVE_VALIDATOR === '1') {
	const { RouteValidator } = await import('../../../src/validator/route')
	try {
		// eslint-disable-next-line no-new
		new RouteValidator(hook, {
			aot: { method: payload.method, path: payload.path }
		} as any)
		out('RESULT', { liveValidatorThrew: false })
	} catch (error: any) {
		out('RESULT', {
			liveValidatorThrew: true,
			message: String(error?.message).slice(0, 60)
		})
	}
	process.exit(0)
}

const validator =
	process.env.USE_RECONSTRUCT_VALIDATOR === '1'
		? reconstructValidator(
				hook,
				root,
				payload.method as any,
				payload.path,
				frozenSlots
			)
		: buildFrozenRouteValidator(
				hook,
				root,
				payload.method as any,
				payload.path,
				frozenSlots
			)

const channel = validator?.[slot]
if (!validator || !channel) {
	out('RESULT', { reconstructed: false })
	process.exit(0)
}

const results = payload.cases.map((value) => {
	try {
		if (slot === 'query') {
			const plan = (validator as any).queryPlan
			const url = `http://localhost/?${value}`
			value = plan.parse(url, url.indexOf('?'), plan.array, plan.object)
		}

		return { ok: true, value: channel.From(value, slot) }
	} catch (error: any) {
		return { ok: false, status: error?.status ?? 500 }
	}
})

out('RESULT', { reconstructed: true, routeValidatorTouched, results })
