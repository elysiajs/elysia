import { SchemaCompile as Compile, Build } from '../typebox-value'

import {
	reconstruct,
	EMPTY_EXTERNALS,
	type CheckBuildResult,
	type CapturedValidator,
	type FrozenValidator
} from '../../compile/aot'
import { buildFrozenCheck } from './frozen-check'
import { nullObject } from '../../utils'

// a property key, a tuple index (number) or array items, so the walk knows
// the container kind. For array items the walk steps into the first item
// failing `items`, the item TypeBox reports first
type Segment = string | number | { items: any }

interface UnionInfo {
	node: any

	// path segments to the union value
	segments: Segment[]

	// which branch (index into anyOf/oneOf) this node lives under
	branchIndex: number
}

interface CustomErrorNode {
	// RFC 6901 JSON-pointer
	path: string

	node: any
	segments: Segment[]

	// the last segment is a required key of a plain object
	required?: boolean

	// nearest enclosing union
	union?: UnionInfo
}

function encodePointer(segments: Segment[]): string {
	let out = ''
	for (const s of segments)
		out +=
			'/' +
			(typeof s === 'object'
				? '[]'
				: String(s).replace(/~/g, '~0').replace(/\//g, '~1'))

	return out
}

function collectCustomErrorNodes(
	schema: any,
	segments: Segment[],
	out: CustomErrorNode[],
	seen: WeakSet<object>,
	union?: UnionInfo,
	required?: boolean
) {
	if (!schema || typeof schema !== 'object') return out
	if (seen.has(schema)) return out

	seen.add(schema)

	if (schema.error !== undefined)
		out.push({
			path: encodePointer(segments),
			node: schema,
			segments,
			required,
			union
		})

	if (schema.properties) {
		// development reports a union branch's own missing key at the union
		const keys =
			union?.segments !== segments && Array.isArray(schema.required)
				? schema.required
				: undefined

		for (const k in schema.properties)
			collectCustomErrorNodes(
				schema.properties[k],
				[...segments, k],
				out,
				seen,
				union,
				keys?.includes(k)
			)
	}

	const items = schema.items
	if (Array.isArray(items)) {
		for (let i = 0; i < items.length; i++)
			collectCustomErrorNodes(
				items[i],
				[...segments, i],
				out,
				seen,
				union
			)
	} else if (items && typeof items === 'object')
		collectCustomErrorNodes(
			items,
			[...segments, { items }],
			out,
			seen,
			union
		)

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

const literalOf = (propSchema: any) => {
	if (!propSchema || typeof propSchema !== 'object') return
	if ('const' in propSchema) return { value: propSchema.const }
	if (Array.isArray(propSchema.enum) && propSchema.enum.length === 1)
		return { value: propSchema.enum[0] }
}

const findDiscriminators = (branches: any[]) => {
	// candidate keys present with a single-literal in every object branch
	let candidates: Set<string> | undefined

	for (const branch of branches) {
		if (!branch?.properties) return null

		const keys = new Set<string>()
		for (const k in branch.properties)
			if (literalOf(branch.properties[k])) keys.add(k)

		if (!candidates) candidates = keys
		else
			for (const c of [...candidates])
				if (!keys.has(c)) candidates.delete(c)

		if (!candidates.size) return null
	}

	if (!candidates) return null

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

	return hasDisambiguating ? perBranch : null
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

	const checkCache = new WeakMap<object, (v: unknown) => boolean>()
	const discriminatorCache = new WeakMap<
		object,
		Array<Record<string, unknown>> | null
	>()

	const compileOnce = (node: any): ((v: unknown) => boolean) | undefined => {
		const cached = checkCache.get(node)
		if (cached) return cached
		try {
			const uc = Compile(node)
			const fn = (v: unknown) => uc.Check(v)
			checkCache.set(node, fn)
			return fn
		} catch {
			return undefined
		}
	}

	let found: unknown

	const reach = (value: unknown, segments: Segment[]) => {
		let current: any = value
		for (let i = 0; i < segments.length; i++) {
			const s = segments[i]
			if (
				current === null ||
				typeof current !== 'object' ||
				// a property key needs a non-array object, the rest an array
				Array.isArray(current) === (typeof s === 'string')
			)
				return -1

			if (typeof s === 'object') {
				const check = compileOnce(s.items)
				const at = check
					? current.findIndex((x: unknown) => !check(x))
					: -1
				if (at < 0) return -1

				current = current[at]
			} else if (s in current) current = current[s]
			else return i === segments.length - 1 ? 0 : -1
		}

		found = current
		return 1
	}

	const discriminatorsOf = (node: any, branches: any[]) => {
		if (!discriminatorCache.has(node))
			discriminatorCache.set(node, findDiscriminators(branches))

		return discriminatorCache.get(node) ?? undefined
	}

	const checks: {
		segments: Segment[]
		required?: boolean
		check: (v: unknown) => boolean
		gate?: (root: unknown) => boolean
		path: string
		error: unknown
	}[] = []

	for (const { path, node, segments, required, union } of nodes) {
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

		let gate: ((root: unknown) => boolean) | undefined
		if (union) {
			const branches: any[] = union.node.anyOf ?? union.node.oneOf ?? []
			const discriminators = discriminatorsOf(union.node, branches)

			if (!discriminators) gate = () => true
			else {
				const unionCheck = compileOnce(union.node)
				if (!unionCheck) continue

				const unionSegments = union.segments
				const branchIndex = union.branchIndex

				gate = (root) => {
					if (reach(root, unionSegments) < 1) return true

					const unionValue = found
					// union succeeds → no error to report
					if (unionCheck(unionValue)) return true
					if (unionValue === null || typeof unionValue !== 'object')
						return true

					// value must match this branch's discriminators and
					// no other branch's, so selection is unambiguous.
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

		checks.push({
			segments,
			required,
			check,
			gate,
			path,
			error: node.error
		})
	}

	if (!checks.length) return

	// deepest first; a stable sort keeps siblings in declaration order, the
	// order TypeBox reports them in
	checks.sort((a, b) => b.segments.length - a.segments.length)

	return (value) => {
		for (const c of checks) {
			if (c.gate && c.gate(value)) continue

			const at = reach(value, c.segments)
			if (at < 0 || (!at && !c.required)) continue

			// a missing required key fails even if its schema accepts undefined
			if (!at || !c.check(found))
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
