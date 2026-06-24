import { Compile, Build } from 'typebox/schema'

import {
	collectExternals,
	EMPTY_EXTERNALS,
	type CheckBuildResult,
	type CapturedValidator,
	type FrozenValidator
} from '../../compile/aot'
import { buildFrozenCheck } from './frozen-check'

interface CustomErrorNode {
	path: string
	node: any
	each?: boolean
	// Nearest enclosing union (anyOf/oneOf)
	union?: { node: any; path: string }
}

function collectCustomErrorNodes(
	schema: any,
	path: string,
	out: CustomErrorNode[],
	union?: { node: any; path: string }
) {
	if (!schema || typeof schema !== 'object') return out
	if (schema.error !== undefined) out.push({ path, node: schema, union })
	if (schema.properties)
		for (const k in schema.properties)
			collectCustomErrorNodes(
				schema.properties[k],
				path + '/' + k,
				out,
				union
			)

	const items = schema.items
	if (Array.isArray(items)) {
		// Tuple: every element has a fixed index, so it is value-addressable
		for (let i = 0; i < items.length; i++)
			collectCustomErrorNodes(items[i], path + '/' + i, out, union)
	} else if (items && items.error !== undefined)
		out.push({ path, node: items, each: true, union })

	const branches = schema.anyOf ?? schema.oneOf
	if (Array.isArray(branches)) {
		const gate = { node: schema, path }
		for (const branch of branches)
			collectCustomErrorNodes(branch, path, out, gate)
	}

	return out
}

function subValueAt(value: any, path: string): unknown {
	if (!path) return value
	let cur = value

	for (const part of path.split('/')) {
		if (!part) continue
		if (cur === null || typeof cur !== 'object') return
		cur = cur[part]
	}

	return cur
}

export function buildFindCustomError(
	schema: unknown,
	frozen?: FrozenValidator
):
	| ((value: unknown) => { instancePath: string; error: unknown } | undefined)
	| undefined {
	const nodes = collectCustomErrorNodes(schema as any, '', [])
	if (!nodes.length) return

	const frozenByPath = frozen?.ce
		? new Map(frozen.ce.map((e) => [e.p, e]))
		: undefined

	const checks: {
		path: string
		check: (v: unknown) => boolean
		gate?: (root: unknown) => boolean
		error: unknown
	}[] = []

	for (const { path, node, each, union } of nodes) {
		let check: ((v: unknown) => boolean) | undefined

		// Union-branch nodes must not reuse a frozen `ce` entry
		const fe = union ? undefined : frozenByPath?.get(path)
		if (fe)
			try {
				check = fe.c(fe.e ? collectExternals(node) : EMPTY_EXTERNALS)
			} catch {}
		else
			try {
				const c = Compile(node)
				check = (v) => c.Check(v)
			} catch {}

		if (check && each) {
			const elementCheck = check
			check = (v) =>
				!Array.isArray(v) || v.every((x) => elementCheck(x))
		}

		if (!check) continue

		let gate: ((root: unknown) => boolean) | undefined
		if (union) {
			let unionCheck: ((v: unknown) => boolean) | undefined
			try {
				const uc = Compile(union.node)
				unionCheck = (v) => uc.Check(v)
			} catch {}

			if (!unionCheck) continue

			// copy string
			const unionPath = union.path
			gate = (root) => unionCheck!(subValueAt(root, unionPath))
		}

		checks.push({ path, check, gate, error: node.error })
	}

	if (!checks.length) return

	checks.sort((a, b) => b.path.length - a.path.length)

	return (value) => {
		for (const c of checks) {
			if (c.gate && c.gate(value)) continue
			if (!c.check(subValueAt(value, c.path)))
				return { instancePath: c.path, error: c.error }
		}
	}
}

export function captureCustomErrors(
	schema: unknown
): CapturedValidator['customErrors'] | undefined {
	const ceNodes = collectCustomErrorNodes(schema as any, '', [])
	if (!ceNodes.length) return

	const entries: NonNullable<CapturedValidator['customErrors']> = []
	for (const { path, node, union } of ceNodes) {
		if (union) continue

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
