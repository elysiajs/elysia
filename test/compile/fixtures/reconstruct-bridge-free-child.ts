/** Runs `Reconstrct.validator` with the TypeBox bridge deliberately unwired. */
import { readFileSync } from 'node:fs'

import { type CapturedValidator } from '../../../src/compile/aot'
import { hasTypes, isBridgeLive } from '../../../src/type/bridge'
import { claimManifest, materialise } from '../../aot/_manifest'

const out = (tag: string, data: unknown) =>
	console.log(tag, JSON.stringify(data))

// The bridge must remain unwired for this process to isolate the
// `!isBridgeLive()` branch in `Reconstrct.validator`.
try {
	hasTypes([], { '~kind': 'Object' } as any)
	out('BRIDGE', 'wired')
	process.exit(2)
} catch {
	out('BRIDGE', 'unwired')
}

out('LIVE', isBridgeLive())

const payload = JSON.parse(readFileSync(process.env.PAYLOAD!, 'utf8')) as {
	captured: CapturedValidator[]
	schema: unknown
	method: string
	path: string
}

const claimed = claimManifest({ validators: materialise(payload.captured) })
const hook = { body: payload.schema } as any
const root = { ...claimed, '~config': {}, '~ext': {} } as any

// Exercise the actual detour site directly: `Reconstrct.validator` must
// either return a frozen validator without ever wiring the bridge, or
// (when reconstruction is impossible) surface the same
// "Typebox module isn't initialized" error the wired path would throw.
const { Reconstrct } = await import(
	'../../../src/compile/handler/reconstruct'
)

try {
	const result = Reconstrct.validator(
		hook,
		root,
		payload.method as any,
		payload.path
	)
	out('RESULT', {
		threw: false,
		reconstructed: !!result && !!(result as any).body,
		liveAfter: isBridgeLive()
	})
} catch (error: any) {
	out('RESULT', {
		threw: true,
		message: String(error?.message).slice(0, 60),
		liveAfter: isBridgeLive()
	})
}
