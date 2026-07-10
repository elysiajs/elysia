import { Compile, Build } from 'typebox/schema'

import {
	reconstruct,
	EMPTY_EXTERNALS,
	type CheckBuildResult,
	type CapturedValidator,
	type FrozenValidator
} from '../../compile/aot'
import { buildFrozenCheck } from './frozen-check'
import { nullObject } from '../../utils'

interface UnionInfo {
	node: any

	// path segments to the union value (element-relative when inside `each`)
	segments: string[]

	// which branch (index into anyOf/oneOf) this node lives under
	branchIndex: number
}

interface CustomErrorNode {
	// RFC 6901 JSON-pointer
	path: string

	node: any
	segments: string[]
	each?: { itemSegments: string[] }

	// nearest enclosing union
	union?: UnionInfo
}

function encodePointer(segments: string[]): string {
	let out = ''
	for (const s of segments)
		out += '/' + s.replace(/~/g, '~0').replace(/\//g, '~1')

	return out
}

function collectCustomErrorNodes(
	schema: any,
	segments: string[],
	out: CustomErrorNode[],
	seen: WeakSet<object>,
	union?: UnionInfo
) {
	if (!schema || typeof schema !== 'object') return out
	if (seen.has(schema)) return out

	seen.add(schema)

	if (schema.error !== undefined)
		out.push({
			path: encodePointer(segments),
			node: schema,
			segments,
			union
		})

	if (schema.properties)
		for (const k in schema.properties)
			collectCustomErrorNodes(
				schema.properties[k],
				[...segments, k],
				out,
				seen,
				union
			)

	const items = schema.items
	if (Array.isArray(items)) {
		for (let i = 0; i < items.length; i++)
			collectCustomErrorNodes(
				items[i],
				[...segments, String(i)],
				out,
				seen,
				union
			)
	} else if (items && typeof items === 'object') {
		const inner: CustomErrorNode[] = []
		collectCustomErrorNodes(items, [], inner, seen, union)

		for (const child of inner)
			out.push({
				path: encodePointer(segments) + '/[]' + child.path,
				node: child.node,
				segments,
				each: { itemSegments: child.segments },
				// nested unions inside array items keep their own gate; a union
				// straddling the array boundary is not disambiguated here.
				union: child.union
			})
	}

	const branches = schema.anyOf ?? schema.oneOf
	if (Array.isArray(branches))
		for (let i = 0; i < branches.length; i++)
			collectCustomErrorNodes(branches[i], segments, out, seen, {
				node: schema,
				segments,
				branchIndex: i
			})

	seen.delete(schema)

	return out
}

function subValueAt(value: any, segments: string[]): unknown {
	let cur = value
	for (const part of segments) {
		if (cur === null || typeof cur !== 'object') return
		cur = cur[part]
	}

	return cur
}

const literalOf = (propSchema: any) => {
	if (!propSchema || typeof propSchema !== 'object') return
	if ('const' in propSchema) return { value: propSchema.const }
	if (Array.isArray(propSchema.enum) && propSchema.enum.length === 1)
		return { value: propSchema.enum[0] }
}

function computeDiscriminators(
	branches: any[]
): Array<Record<string, unknown>> | undefined {
	// candidate keys present with a single-literal in every object branch
	let candidates: Set<string> | undefined

	for (const branch of branches) {
		if (!branch || !branch.properties) return

		const keys = new Set<string>()
		for (const k in branch.properties)
			if (literalOf(branch.properties[k])) keys.add(k)

		if (!keys.size) return

		if (!candidates) candidates = keys
		else
			for (const c of [...candidates])
				if (!keys.has(c)) candidates.delete(c)

		if (!candidates.size) return
	}

	if (!candidates || !candidates.size) return

	const perBranch: Array<Record<string, unknown>> = branches.map(nullObject)
	let hasDisambiguating = false

	for (const key of candidates) {
		const seenValues: unknown[] = []
		for (let i = 0; i < branches.length; i++) {
			const lit = literalOf(branches[i].properties[key])!
			perBranch[i][key] = lit.value
			seenValues.push(lit.value)
		}

		// distinct across all branches → this key can disambiguate
		if (new Set(seenValues).size === branches.length)
			hasDisambiguating = true
	}

	return hasDisambiguating ? perBranch : undefined
}

export function buildFindCustomError(
	schema: unknown,
	frozen?: FrozenValidator
):
	| ((value: unknown) => { instancePath: string; error: unknown } | undefined)
	| undefined {
	const nodes = collectCustomErrorNodes(schema as any, [], [], new WeakSet())
	if (!nodes.length) return

	const frozenByPath = frozen?.ce
		? new Map(frozen.ce.map((e) => [e.p, e]))
		: undefined

	const unionCheckCache = new WeakMap<object, (v: unknown) => boolean>()
	const discriminatorCache = new WeakMap<
		object,
		Array<Record<string, unknown>> | null
	>()

	const compileUnion = (node: any): ((v: unknown) => boolean) | undefined => {
		const cached = unionCheckCache.get(node)
		if (cached) return cached
		try {
			const uc = Compile(node)
			const fn = (v: unknown) => uc.Check(v)
			unionCheckCache.set(node, fn)
			return fn
		} catch {
			return undefined
		}
	}

	const discriminatorsOf = (node: any, branches: any[]) => {
		if (discriminatorCache.has(node))
			return discriminatorCache.get(node) ?? undefined

		const d = computeDiscriminators(branches) ?? null
		discriminatorCache.set(node, d)

		return d ?? undefined
	}

	const checks: {
		segments: string[]
		each?: { itemSegments: string[] }
		check: (v: unknown) => boolean
		gate?: (root: unknown) => boolean
		path: string
		error: unknown
	}[] = []

	for (const { path, node, each, segments, union } of nodes) {
		let check: ((v: unknown) => boolean) | undefined

		// Union-branch nodes must not reuse a frozen `ce` entry
		const fe = union ? undefined : frozenByPath?.get(path)
		if (fe)
			try {
				check = fe.c(
					fe.e
						? reconstruct().collectExternals(node)
						: EMPTY_EXTERNALS
				)
			} catch {}
		else
			try {
				const c = Compile(node)
				check = (v) => c.Check(v)
			} catch {}

		if (!check) continue

		if (each) {
			const leafCheck = check
			const itemSegments = each.itemSegments
			check = (v) =>
				!Array.isArray(v) ||
				v.every((x) => leafCheck(subValueAt(x, itemSegments)))
		}

		let gate: ((root: unknown) => boolean) | undefined
		if (union) {
			const branches: any[] = union.node.anyOf ?? union.node.oneOf ?? []
			const discriminators = discriminatorsOf(union.node, branches)

			if (!discriminators) gate = () => true
			else {
				const unionCheck = compileUnion(union.node)
				if (!unionCheck) continue

				const unionSegments = union.segments
				const branchIndex = union.branchIndex

				gate = (root) => {
					const unionValue = subValueAt(root, unionSegments)
					// union succeeds → no error to report
					if (unionCheck(unionValue)) return true
					if (unionValue === null || typeof unionValue !== 'object')
						return true

					// value must match THIS branch's discriminators and no
					// other branch's, so selection is unambiguous.
					let matches = 0
					let selected = -1
					for (let i = 0; i < discriminators.length; i++) {
						const req = discriminators[i]
						let ok = true
						for (const k in req)
							if ((unionValue as any)[k] !== req[k]) {
								ok = false
								break
							}

						if (ok) {
							matches++
							selected = i
						}
					}

					// gate=false means "run this check". Only when exactly one
					// branch matches and it is this one.
					return !(matches === 1 && selected === branchIndex)
				}
			}
		}

		checks.push({ segments, each, check, gate, path, error: node.error })
	}

	if (!checks.length) return

	// deepest path first (by segment count, then path length as a tiebreak)
	checks.sort(
		(a, b) =>
			b.segments.length - a.segments.length ||
			b.path.length - a.path.length
	)

	return (value) => {
		for (const c of checks) {
			if (c.gate && c.gate(value)) continue
			if (!c.check(subValueAt(value, c.segments)))
				return { instancePath: c.path, error: c.error }
		}
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
	for (const { path, node, union, each } of ceNodes) {
		// union-branch and array-element nodes are handled at runtime only
		if (union || each) continue

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
