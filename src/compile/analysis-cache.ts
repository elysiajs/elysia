import type { AnyElysia } from '../base'
import { clearSucroseCache } from '../sucrose'
import { clearHandlerAnalysisCaches } from './handler'

/** Drop recomputable authoring analysis after a strict runtime image publishes. */
export function clearAuthoringAnalysisCaches(root: AnyElysia) {
	clearSucroseCache()
	clearHandlerAnalysisCaches(root)
}
