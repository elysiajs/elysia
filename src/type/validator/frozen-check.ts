import type { CheckBuildResult } from '../../compile/aot'
import { alignBuildExternals, reconstructCheck } from '../../compile/aot-emit'

export function buildFrozenCheck(
	build: CheckBuildResult | undefined,
	node: any
):
	| {
			identifier: string
			checkDefs: string
			checkValue: string
			external: boolean
	  }
	| undefined {
	if (!build?.functions?.length || !build.entry) return

	// the live schema must reproduce this build's externals
	const aligned = alignBuildExternals(build, node)
	if (!aligned) return
	const check = reconstructCheck(aligned)

	return {
		identifier: aligned.external.identifier,
		checkDefs: check.defs,
		checkValue: check.value,
		external: aligned.external.variables.length > 0
	}
}
