/**
 * Build-only source emitters + capture-time verifiers for the AOT manifest.
 *
 * Kept out of `aot-reconstruct.ts` (the runtime-shipped `elysia/reconstruct`
 * module) so sealed bundles don't carry them
 */
import { Compiled, type CheckBuildResult } from './aot'
import {
	collectExternals,
	collectMirrorCodecs,
	collectMirrorUnions,
	Reconstruct
} from './aot-reconstruct'

export function reconstructCheck(build: CheckBuildResult): {
	defs: string
	value: string
} {
	const defs = build.functions.join(';\n')

	if (!build.useUnevaluated) {
		const single = /^([A-Za-z_$][\w$]*)\(value\)$/.exec(build.entry.trim())
		if (single) return { defs, value: single[1] }
	}

	const statements =
		(build.useUnevaluated
			? 'const context = new CheckContext({}, {});\n'
			: '') + `return ${build.entry}`

	return { defs, value: `(value) => { ${statements} }` }
}

const checkCode = (defs: string, value: string) => `${defs}; return ${value}`

function reconstructCheckCode(build: CheckBuildResult) {
	const { defs, value } = reconstructCheck(build)
	return checkCode(defs, value)
}

// emit into bundle for frozen check
const checkFactorySource = (identifier: string, code: string) =>
	`function(${identifier}){${code}}`

const handlerFactorySource = (alias: string, code: string) =>
	`function(h${alias ? ',' + alias : ''}){return ${code}}`

export function externalsMatch(a: unknown[], b: unknown[]) {
	if (a.length !== b.length) return false

	for (let i = 0; i < a.length; i++) {
		const x = a[i] as any
		const y = b[i] as any

		if (x === y) continue

		if (x instanceof RegExp && y instanceof RegExp) {
			if (x.source !== y.source || x.flags !== y.flags) return false
			continue
		}

		if (Array.isArray(x) && Array.isArray(y)) {
			if (x.length !== y.length) return false

			let ok = true
			for (let j = 0; j < x.length; j++)
				if (x[j] !== y[j]) {
					ok = false
					break
				}

			if (ok) continue
		}

		return false
	}

	return true
}

const mirrorFactorySource = (source: string, hasExternals: boolean) =>
	hasExternals
		? // union: a factory `(d) => (v) => cleaned`. `d` injects the branch checks
			`function(d){${source}}`
		: // plain: the cleaner `(v) => cleaned` directly (no unused-`d` factory)
			`function(v){${source}}`

// Merged check + mirror factory (cm)
const bothFactorySource = (
	identifier: string,
	checkDefs: string,
	checkValue: string,
	mirrorSource: string,
	mirrorHasExternals: boolean
) =>
	`function(${identifier},d){${checkDefs}; return{check:${checkValue},clean:${
		mirrorHasExternals
			? `(function(d){${mirrorSource}})(d)`
			: `function(v){${mirrorSource}}`
	}}}`

// ? Build-only: these source emitters are imported solely by `plugin/aot/source.ts`
export const Source = {
	checkFactory: checkFactorySource,
	checkCode: checkCode,
	handlerFactory: handlerFactorySource,
	mirrorFactory: mirrorFactorySource,
	bothFactory: bothFactorySource
} as const

/**
 * verify that mirror unions can be reconstructed in build time
 *
 * return undefined if not reconstructable
 * `truthUnions` is `mir.externals.unions` (compiled branches).
 */
export function captureMirrorUnions(schema: unknown, truthUnions: any[][]) {
	const branchSchemas = collectMirrorUnions(schema)
	if (branchSchemas.length !== truthUnions.length) return

	const u: { identifier: string; code: string }[][] = []

	for (let ui = 0; ui < truthUnions.length; ui++) {
		if (
			!branchSchemas[ui] ||
			branchSchemas[ui]!.length !== truthUnions[ui]!.length
		)
			return

		const branch: { identifier: string; code: string }[] = []

		for (let i = 0; i < truthUnions[ui]!.length; i++) {
			const build = truthUnions[ui]![i]?.buildResult as
				| CheckBuildResult
				| undefined

			if (!build?.functions?.length || !build.entry) return

			// the live branch schema must reproduce this branch's externals
			if (
				!externalsMatch(
					collectExternals(branchSchemas[ui]![i]),
					build.external.variables
				)
			)
				return

			branch.push({
				identifier: build.external.identifier,
				code: reconstructCheckCode(build)
			})
		}

		u.push(branch)
	}
	return u
}

export function captureMirrorCodecs(
	schema: unknown,
	truthCodecs: Function[],
	dir: 'decode' | 'encode' = 'decode'
) {
	const codecs = collectMirrorCodecs(schema, [], dir)
	if (codecs.length !== truthCodecs.length) return false

	for (let i = 0; i < codecs.length; i++)
		if (codecs[i] !== truthCodecs[i]) return false

	return true
}

export function installReconstructImpl() {
	Compiled.reconstruct = Reconstruct
}
