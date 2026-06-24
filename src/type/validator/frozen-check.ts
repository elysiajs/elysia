import type { CheckBuildResult } from '../../compile/aot'
import { collectExternals, externalsMatch, reconstructCheck } from '../../compile/aot'

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
	const vars = build.external.variables

	if (!externalsMatch(collectExternals(node), vars)) return
	const cr = reconstructCheck(build)

	return {
		identifier: build.external.identifier,
		checkDefs: cr.defs,
		checkValue: cr.value,
		external: vars.length > 0
	}
}
