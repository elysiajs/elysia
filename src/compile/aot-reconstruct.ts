/**
 * Frozen-manifest reconstruction + source emitters.
 *
 * Kept out of `aot.ts` so apps that never load a generated manifest module
 * tree-shake it: runtime call sites reach these through `reconstruct()`
 * (see `aot.ts`), wired by the generated `elysia/reconstruct`
 *
 * Everything here is pure (no module state): the stateful registration goes
 * through `Compiled` from `registerFrom`, so a duplicate copy of this module
 * resolving from another elysia install still reconstructs correctly.
 */
import { ELYSIA_TYPES } from '../type/constants'
import {
	Compiled,
	EMPTY_EXTERNALS,
	type CheckBuildResult,
	type FrozenCheckFactory,
	type FrozenMirror,
	type FrozenMirrorFactory,
	type FrozenValidator,
	type ReconstructImpl,
	type StringCodecNode
} from './aot'

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

const isValueLikeExternal = (v: unknown) =>
	v === null || (typeof v !== 'object' && typeof v !== 'function')

/**
 * Rebuild TypeBox `External[]` for `schema` in `BuildSchema` traversal order:
 * object (patternProperties → properties) → array (items) → string (pattern) →
 * guard → const → enum → not/allOf/anyOf/oneOf → refine LAST.
 */
export function collectExternals(schema: any, out: unknown[] = []) {
	if (!schema || typeof schema !== 'object') return out

	const pp = schema.patternProperties
	if (pp)
		for (const pattern in pp) {
			out.push(new RegExp(pattern, 'u'))
			collectExternals(pp[pattern], out)
		}

	if (schema.properties)
		for (const k in schema.properties)
			collectExternals(schema.properties[k], out)

	const items = schema.items
	if (Array.isArray(items)) for (const it of items) collectExternals(it, out)
	else if (items) collectExternals(items, out)

	if (typeof schema.pattern === 'string')
		out.push(new RegExp(schema.pattern, 'u'))

	if (schema['~guard']) out.push(schema)

	if ('const' in schema && !isValueLikeExternal(schema.const))
		out.push(schema.const)

	if (Array.isArray(schema.enum))
		for (const o of schema.enum) if (!isValueLikeExternal(o)) out.push(o)

	if (schema.not) collectExternals(schema.not, out)
	if (Array.isArray(schema.allOf))
		for (const s of schema.allOf) collectExternals(s, out)
	if (Array.isArray(schema.anyOf))
		for (const s of schema.anyOf) collectExternals(s, out)
	if (Array.isArray(schema.oneOf))
		for (const s of schema.oneOf) collectExternals(s, out)

	if (schema['~refine']) out.push(schema['~refine'])

	return out
}

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

export function collectMirrorUnions(schema: any, out: unknown[][] = []) {
	if (!schema || typeof schema !== 'object') return out

	if (schema.type === 'object' && schema.properties)
		for (const key in schema.properties)
			collectMirrorUnions(schema.properties[key], out)
	else if (schema.type === 'array' && schema.items) {
		if (Array.isArray(schema.items))
			for (const it of schema.items) collectMirrorUnions(it, out)
		else collectMirrorUnions(schema.items, out)
	} else if (Array.isArray(schema.anyOf)) {
		out.push(schema.anyOf)

		// exact-mirror mirrors EACH union branch twice
		for (const b of schema.anyOf) {
			collectMirrorUnions(b, out)
			collectMirrorUnions(b, out)
		}
	}

	return out
}

function collectMirrorCodecs(
	schema: any,
	out: Function[] = [],
	dir: 'decode' | 'encode' = 'decode'
): Function[] {
	if (!schema || typeof schema !== 'object') return out

	const codec = schema['~codec']
	if (
		codec &&
		typeof codec[dir] === 'function' &&
		out.indexOf(codec[dir]) === -1
	)
		out.push(codec[dir])

	if (schema.type === 'object' && schema.properties)
		for (const key in schema.properties)
			collectMirrorCodecs(schema.properties[key], out, dir)
	else if (schema.type === 'array' && schema.items) {
		if (Array.isArray(schema.items))
			for (const it of schema.items) collectMirrorCodecs(it, out, dir)
		else collectMirrorCodecs(schema.items, out, dir)
	} else if (Array.isArray(schema.anyOf))
		for (const b of schema.anyOf) collectMirrorCodecs(b, out, dir)

	return out
}

// Rebuild exact-mirror's `d.unions` from live schema
function buildUnions(u: FrozenCheckFactory[][], schema: unknown) {
	const branchSchemas = collectMirrorUnions(schema)

	return u.map((branches, ui) =>
		branches.map((factory, i) => ({
			Check: factory(collectExternals(branchSchemas[ui]![i]))
		}))
	)
}

export function instantiateFrozenMirror(
	frozen: FrozenMirror,
	schema: unknown
): (value: unknown) => unknown {
	// Plain mirror: `s` is the cleaner itself (no factory wrapper to call).
	if (!frozen.u) return frozen.s as (value: unknown) => unknown

	return (frozen.s as FrozenMirrorFactory)({
		unions: buildUnions(frozen.u, schema)
	})
}

// Codec mirror: `d.codecs` are the live schema's `~codec.decode` (request) or
// `~codec.encode` (response) leaves; `d.unions` when the schema has unions.
export function instantiateFrozenDecodeMirror(
	frozen: FrozenMirror,
	schema: unknown,
	dir: 'decode' | 'encode' = 'decode'
): (value: unknown) => unknown {
	const d: { codecs: Function[]; unions?: unknown } = {
		codecs: collectMirrorCodecs(schema, [], dir)
	}

	if (frozen.u) d.unions = buildUnions(frozen.u, schema)

	return (frozen.s as FrozenMirrorFactory)(d)
}

export const instantiateFrozenEncodeMirror = (
	frozen: FrozenMirror,
	schema: unknown
): ((value: unknown) => unknown) =>
	instantiateFrozenDecodeMirror(frozen, schema, 'encode')

export function instantiateFrozenBoth(
	frozen: FrozenValidator,
	checkSchema: unknown,
	mirrorSchema: unknown
): {
	check?: (value: unknown) => boolean
	clean?: (value: unknown) => unknown
} {
	return frozen.cm!(
		frozen.e ? collectExternals(checkSchema) : EMPTY_EXTERNALS,
		frozen.u ? { unions: buildUnions(frozen.u, mirrorSchema) } : undefined
	)
}

// ObjectString/ArrayString inner-codec reconstruction
//
// The traversal order is the capture↔reconstruct contract: `ic[i]` aligns 1:1
// with `nodes[i]` (reconstruct iterates in reverse for bottom-up overwrite)
//
// keep self → properties → items → anyOf
export function collectStringCodecNodes(
	schema: any,
	out: StringCodecNode[] = []
): StringCodecNode[] {
	if (!schema || typeof schema !== 'object') return out

	const ely = schema['~elyTyp']
	if (ely === ELYSIA_TYPES.ObjectString || ely === ELYSIA_TYPES.ArrayString) {
		const inner = schema.anyOf?.[0]
		const codec = schema.anyOf?.[1]
		if (inner && codec?.['~codec'] && codec['~refine'])
			out.push({
				inner,
				codec,
				open: ely === ELYSIA_TYPES.ObjectString ? 123 : 91
			})
	}

	if (schema.properties)
		for (const k in schema.properties)
			collectStringCodecNodes(schema.properties[k], out)

	const items = schema.items
	if (Array.isArray(items)) {
		for (const it of items) collectStringCodecNodes(it, out)
	} else if (items) collectStringCodecNodes(items, out)

	if (Array.isArray(schema.anyOf))
		for (const b of schema.anyOf) collectStringCodecNodes(b, out)

	return out
}

/**
 * Overwrite every ObjectString/ArrayString node's `~refine[0].check` and
 * `~codec.decode` with the baked `ic` closures. After this runs, the node no
 * longer calls the constructor's live `typebox/value` Check/Decode
 *
 * Iterate in reverse so nested codecs reconstruct bottom-up.
 */
export function reconstructInnerCodecs(
	ic: NonNullable<FrozenValidator['ic']>,
	schema: any
): void {
	const nodes = collectStringCodecNodes(schema)

	for (let i = nodes.length - 1; i >= 0; i--) {
		const entry = ic[i]
		const node = nodes[i]
		if (!entry || !node) continue

		const innerSchema = node.inner
		const innerCheck = entry.c(entry.e ? collectExternals(innerSchema) : [])
		const innerMirror = entry.d.x
			? instantiateFrozenDecodeMirror(entry.d, innerSchema)
			: (entry.d.s as (value: unknown) => unknown)

		const open = entry.o
		node.codec['~refine'][0].check = (v: string) => {
			if (v.charCodeAt(0) !== open) return false

			try {
				return innerCheck(JSON.parse(v))
			} catch {
				return false
			}
		}

		node.codec['~codec'].decode = (v: string) => innerMirror(JSON.parse(v))
	}
}

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

/** Runtime reconstruction table the generated manifest module registers. */
export const Reconstruct: ReconstructImpl = {
	collectExternals,
	collectMirrorUnions,
	collectStringCodecNodes,
	instantiateFrozenMirror,
	instantiateFrozenDecodeMirror,
	instantiateFrozenBoth,
	reconstructInnerCodecs
}

export function installReconstructImpl() {
	Compiled.reconstruct = Reconstruct
}
