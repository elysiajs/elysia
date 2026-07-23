import type { AnyElysia } from '../base'

import { clearSucroseCache } from '../sucrose'
import { clearFlattenChainMemo } from '../utils'
import { clearHandlerAnalysisCaches } from './handler'

export function clearAuthoringAnalysisCaches(root: AnyElysia) {
	clearSucroseCache()
	clearHandlerAnalysisCaches(root)
	clearFlattenChainMemo(root)
}
