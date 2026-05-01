import type { AnyElysia } from './base'
import { clearSucroseCache } from './sucrose'
import { clearContextCache } from './context'

import { isBun } from './universal/utils'

export function flushMemory(app?: AnyElysia) {
	clearSucroseCache(0)
	clearContextCache()
	app?.clear()

	if (isBun) Bun.gc()
	else if (typeof global?.gc === 'function') global.gc()
}
