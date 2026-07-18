/** Runs captured validators with the TypeBox bridge deliberately unwired. */
import { readFileSync } from 'node:fs'
import { validationPlan } from '../../../src/experimental/validation-plan'

import { type CapturedValidator } from '../../../src/compile/aot'
import { buildFrozenRouteValidator } from '../../../src/compile/handler/frozen-validator'
import { hasTypes } from '../../../src/type/bridge'
import { claimManifest, materialise } from '../_manifest'

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

const payload = JSON.parse(readFileSync(process.env.PAYLOAD!, 'utf8')) as {
	captured: CapturedValidator[]
	schema: unknown
	cases: unknown[]
	method: string
	path: string
	slot?: 'body' | 'query'
}

const claimed = claimManifest({ validators: materialise(payload.captured) })

const slot = payload.slot ?? 'body'
const hook = { [slot]: payload.schema } as any
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

const validator = buildFrozenRouteValidator(
	hook,
	root,
	payload.method as any,
	payload.path
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

out('RESULT', { reconstructed: true, results })
