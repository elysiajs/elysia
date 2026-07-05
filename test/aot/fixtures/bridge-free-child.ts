/**
 * Child process for `bridge-free-subprocess.test.ts`.
 *
 * Runs with the TypeBox bridge NEVER wired: it imports ONLY the reconstruct
 * machinery + `typebox` (for `materialise`), and deliberately does NOT import the
 * elysia type barrel (`src/type/index`), which is the sole caller of
 * `setupTypebox`. So this is a faithful stand-in for a build that stripped compat.
 *
 * Input (env `PAYLOAD`): a JSON file with `{ captured, schema, cases }` produced
 * by the parent (where the bridge IS wired). It:
 *   1. asserts the bridge is unwired (proving the scenario),
 *   2. materialises the captured manifest into `Compiled.validators`,
 *   3. reconstructs the validator bridge-free and runs each case,
 * printing `RESULT <json>` for the parent to assert on.
 *
 * Before the fix, step 3 went through the wired `RouteValidator` and threw
 * "Typebox module isn't initialized" — the parent asserts this child now
 * succeeds where the old path would have failed.
 */
import { readFileSync } from 'node:fs'

import {
	Compiled,
	type CapturedValidator
} from '../../../src/compile/aot'
import { buildFrozenRouteValidator } from '../../../src/compile/handler/frozen-validator'
import { hasTypes } from '../../../src/type/bridge'
import { materialise } from '../_manifest'

const out = (tag: string, data: unknown) =>
	console.log(tag, JSON.stringify(data))

// 1. the bridge MUST be unwired here — otherwise the test proves nothing.
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

// Demonstrate the PRE-CHANGE failure: the wired `RouteValidator` (what
// `Reconstrct.validator` used unconditionally) throws the stripped-bridge error
// on its first bridge touch. This is the exact 500 the fix rescues.
if (process.env.OLD_PATH === '1') {
	const { RouteValidator } = await import('../../../src/validator/route')
	try {
		// eslint-disable-next-line no-new
		new RouteValidator(hook, {
			aot: { method: payload.method, path: payload.path }
		} as any)
		out('RESULT', { oldPathThrew: false })
	} catch (error: any) {
		out('RESULT', {
			oldPathThrew: true,
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
