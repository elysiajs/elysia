import { Elysia } from '../index'
import { createTracer, unionTracePhases } from '../trace'

import type { TraceCapability } from '../trace'

/**
 * ### elysia/trace
 *
 * Runtime trace capability. Register it once so `.trace()` (and any
 * guard-carried / inherited trace hook) has a provider to compile against:
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia'
 * import { trace } from 'elysia/trace'
 *
 * new Elysia()
 *     .use(trace())
 *     .trace(({ onHandle }) => { ... })
 * ```
 */

// Immutable module-level singleton. `id` embeds `import.meta.url` so a
// dual-package (duplicated) copy is distinguishable at merge time. No nonce or
// counter: identical registrations must always yield the same identity so the
// registrar's name+seed checksum can dedup diamond dependencies.
const provider = {
	id: '@elysia/trace@' + import.meta.url,
	createTracer,
	unionTracePhases
} as const satisfies TraceCapability

export const trace = () => {
	const app = new Elysia({ name: '@elysia/trace', seed: provider.id })

	;(
		app as unknown as {
			'~ext': { capability: { trace: { provider: TraceCapability } } }
		}
	)['~ext'] = { capability: { trace: { provider } } }

	return app
}

export { createTracer, unionTracePhases } from '../trace'
export type {
	TraceEvent,
	TraceStream,
	TraceProcess,
	TraceEndDetail,
	TraceListener,
	TraceHandler,
	TraceCapability
} from '../trace'
