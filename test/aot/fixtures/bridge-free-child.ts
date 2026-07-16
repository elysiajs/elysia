/** Runs captured validators with the TypeBox bridge deliberately unwired. */
import { readFileSync } from 'node:fs'

import { Compiled, type CapturedValidator } from '../../../src/compile/aot'
import { buildFrozenRouteValidator } from '../../../src/compile/handler/frozen-validator'
import { hasTypes } from '../../../src/type/bridge'
import { materialise } from '../_manifest'

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
}

Compiled.validators = materialise(payload.captured)

const hook = { body: payload.schema } as any
const root = { '~config': {}, '~ext': {} } as any

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

if (!validator || !(validator as any).body) {
	out('RESULT', { reconstructed: false })
	process.exit(0)
}

const results = payload.cases.map((value) => {
	try {
		return { ok: true, value: (validator as any).body.From(value, 'body') }
	} catch (error: any) {
		return { ok: false, status: error?.status ?? 500 }
	}
})

out('RESULT', { reconstructed: true, results })
