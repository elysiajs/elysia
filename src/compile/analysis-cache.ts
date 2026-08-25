import type { AnyElysia } from '../base'

import { clearFlattenChainMemo } from '../utils'
import { clearHandlerAnalysisCaches } from './handler'

export function clearAuthoringAnalysisCaches(root: AnyElysia) {
	clearHandlerAnalysisCaches(root)
	clearFlattenChainMemo(root)
}
