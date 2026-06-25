/** A handler-JIT entry point the frozen replay can trip over. */
export type JITProbeReason = 'sucrose' | 'handler:new-function'

export interface JITProbeResult {
	/** True when the frozen replay never touched handler JIT. */
	stubbable: boolean
	/** `sucrose` + the handler `new Function` codegen is unused. */
	jit: boolean
	count: number
	reasons: JITProbeReason[]
}

// Module-level tripwire state, mirroring the `Compiled` registry pattern in
// `src/compile/aot.ts` (module `let` + an abstract class of static methods).
let armed = false
let count = 0
const reasons = new Set<JITProbeReason>()

const HANDLER_REASONS: ReadonlySet<JITProbeReason> = new Set<JITProbeReason>([
	'sucrose',
	'handler:new-function'
])

export abstract class JITProbe {
	static isProbing() {
		return armed
	}

	static record(reason: JITProbeReason) {
		if (!armed) return

		count++
		reasons.add(reason)
	}

	static begin(): void {
		armed = true
		count = 0
		reasons.clear()
	}

	static end(): JITProbeResult {
		armed = false

		const fired = [...reasons]
		const result: JITProbeResult = {
			stubbable: count === 0,
			jit: !fired.some((r) => HANDLER_REASONS.has(r)),
			count,
			reasons: fired
		}

		count = 0
		reasons.clear()

		return result
	}
}
