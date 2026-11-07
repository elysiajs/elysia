/** A handler-JIT entry point the frozen replay can trip over. */
export type JITProbeReason =
	| 'sucrose'
	| 'handler:new-function'
	| 'handler:indexed-duplicate'

export interface JITProbeResult {
	/** No route needs sucrose, handler codegen, or indexed duplicate replay. */
	jit: boolean
	reasons: JITProbeReason[]
}

// Module-level tripwire state, mirroring the `Compiled` registry pattern in
// `src/compile/aot.ts` (module `let` + an abstract class of static methods).
let armed = false
const reasons = new Set<JITProbeReason>()

export abstract class JITProbe {
	static record(reason: JITProbeReason) {
		if (!armed) return

		reasons.add(reason)
	}

	static begin() {
		armed = true
		reasons.clear()
	}

	static end(): JITProbeResult {
		armed = false

		const fired = [...reasons]
		reasons.clear()

		return { jit: fired.length === 0, reasons: fired }
	}
}
