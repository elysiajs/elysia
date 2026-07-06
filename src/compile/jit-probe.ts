/** A handler-JIT entry point the frozen replay can trip over. */
export type JITProbeReason = 'sucrose' | 'handler:new-function'

export interface JITProbeResult {
	/** True when the frozen replay never touched handler JIT. */
	stubbable: boolean
	/** `sucrose` + the handler `new Function` codegen is unused. */
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

	static begin(): void {
		armed = true
		reasons.clear()
	}

	static end(): JITProbeResult {
		armed = false

		const fired = [...reasons]
		const unused = fired.length === 0
		const result: JITProbeResult = {
			stubbable: unused,
			jit: unused,
			reasons: fired
		}

		reasons.clear()

		return result
	}
}
