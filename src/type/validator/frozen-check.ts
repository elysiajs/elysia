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
	const b = alignBuildExternals(build, node)
	if (!b) return
	const cr = reconstructCheck(b)

	return {
		identifier: b.external.identifier,
		checkDefs: cr.defs,
		checkValue: cr.value,
		external: b.external.variables.length > 0
	}
}
