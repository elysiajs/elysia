import { clearSucroseCache } from './sucrose'
import { clearContextCache } from './context'

import { isBun } from './universal/constants'
import { Validator } from './validator'

export function flushMemory() {
	clearSucroseCache(0)
	clearContextCache()
	Validator.clear()

	if (isBun) Bun.gc()
	else if (typeof global?.gc === 'function') global.gc()
}
