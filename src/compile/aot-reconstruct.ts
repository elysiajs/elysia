/**
 * Frozen-manifest reconstruction.
 *
 * Kept out of `aot.ts` so apps that never load a generated manifest module
 * tree-shake it: runtime call sites reach these through `reconstruct()`
 * (see `aot.ts`), wired by the generated `elysia/reconstruct`
 *
 * Everything here is pure (no module state): the stateful registration goes
 * through `Compiled` from `registerFrom`, so a duplicate copy of this module
 * resolving from another elysia install still reconstructs correctly.
 *
 * The build-only source emitters/verifiers live in `aot-emit.ts`.
 */
import { ELYSIA_TYPES } from '../type/constants'
import {
	EMPTY_EXTERNALS,
	type FrozenCheckFactory,
	type FrozenMirror,
	type FrozenMirrorFactory,
	type FrozenValidator,
	type ReconstructImpl,
	type StringCodecNode
} from './aot'

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

export function collectMirrorCodecs(
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
