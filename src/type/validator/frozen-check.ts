import { Build } from '../typebox-value'
import type { CapturedValidator, CheckBuildResult } from '../../compile/aot'
import { alignBuildExternals, reconstructCheck } from '../../compile/aot-emit'
import { collectCustomErrorNodes } from './custom-error'

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

export function captureCustomErrors(
	schema: unknown
): CapturedValidator['customErrors'] | undefined {
	const ceNodes = collectCustomErrorNodes(
		schema as any,
		[],
		[],
		new WeakSet()
	)
	if (!ceNodes.length) return

	const entries: NonNullable<CapturedValidator['customErrors']> = []
	for (const { path, node, union, segments } of ceNodes) {
		// union-branch and array-item nodes are handled at runtime only
		if (union || segments.some((s) => typeof s === 'object')) continue

		try {
			const cf = buildFrozenCheck(
				Build(node) as unknown as CheckBuildResult,
				node
			)
			if (cf) entries.push({ path, ...cf })
		} catch {}
	}

	return entries.length ? entries : undefined
}
