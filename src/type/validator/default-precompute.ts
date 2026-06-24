import { Default } from 'typebox/value'
import type { TSchema } from 'typebox/type'

import { nullObject } from '../../utils'

export function isPrecomputeSafe(schema: any, depth = 0): boolean {
	if (!schema || typeof schema !== 'object') return true

	const kind = schema['~kind']
	if (
		kind === 'Union' ||
		kind === 'Intersect' ||
		kind === 'Ref' ||
		kind === 'This' ||
		kind === 'Cyclic'
	)
		return false

	if (schema['~codec'] || schema['~refine']) return false

	// Nested Object without its own default = not preallocatable.
	if (depth > 0 && (kind === 'Object' || schema.type === 'object'))
		if (schema.default === undefined || nestedOwnDefaultDiverges(schema))
			return false

	if (schema.properties)
		for (const key in schema.properties)
			if (
				Object.hasOwn(schema.properties, key) &&
				!isPrecomputeSafe(schema.properties[key], depth + 1)
			)
				return false

	if (schema.items) {
		if (Array.isArray(schema.items)) {
			for (const v of schema.items)
				if (!isPrecomputeSafe(v, depth + 1)) return false
		} else if (!isPrecomputeSafe(schema.items, depth + 1)) return false
	}

	if (
		typeof schema.additionalProperties === 'object' &&
		!isPrecomputeSafe(schema.additionalProperties, depth + 1)
	)
		return false

	if (schema.patternProperties)
		for (const key in schema.patternProperties)
			if (
				Object.hasOwn(schema.patternProperties, key) &&
				!isPrecomputeSafe(schema.patternProperties[key], depth + 1)
			)
				return false

	return true
}

// A nested Object WITH its own `default` is precompute-safe only when that
// own default agrees, field by field, with the defaults its children would
// fill in
function nestedOwnDefaultDiverges(objectSchema: any) {
	const own = objectSchema.default
	if (own === null || typeof own !== 'object' || Array.isArray(own))
		return false

	const props = objectSchema.properties
	if (!props) return false

	for (const key in props) {
		const child = props[key]
		if (!child || typeof child !== 'object') continue

		if ('default' in child) {
			if (
				!(key in own) ||
				canonical((own as any)[key]) !== canonical(child.default)
			)
				return true
		} else if (child['~kind'] === 'Object' || child.type === 'object') {
			if (key in own) {
				if (
					nestedOwnDefaultDiverges({
						...child,
						default: (own as any)[key]
					})
				)
					return true
			} else if (hasDefaultBelow(child)) return true
		}
	}

	return false
}

// recursive merge precompute default
export function applyPrecomputed(
	defaults: Record<string, unknown>,
	value: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = nullObject()

	// clone in case of a shared reference default value
	for (const k in defaults) {
		const d = defaults[k]
		out[k] =
			value[k] === undefined && d !== null && typeof d === 'object'
				? structuredClone(d)
				: d
	}

	for (const k in value) {
		const v = value[k]
		if (v === undefined) continue
		const d = out[k]
		if (
			v &&
			typeof v === 'object' &&
			!Array.isArray(v) &&
			d &&
			typeof d === 'object' &&
			!Array.isArray(d)
		)
			out[k] = applyPrecomputed(
				d as Record<string, unknown>,
				v as Record<string, unknown>
			)
		else out[k] = v
	}

	return out
}

const subtreeHasDefault = (n: any): boolean =>
	!!n &&
	typeof n === 'object' &&
	('default' in n || childSchemaSome(n, subtreeHasDefault))

function childSchemaSome(n: any, f: (x: any) => boolean): boolean {
	if (!n || typeof n !== 'object') return false

	if (n.properties)
		for (const k in n.properties) if (f(n.properties[k])) return true

	const items = n.items
	if (Array.isArray(items)) {
		for (const it of items) if (f(it)) return true
	} else if (items && f(items)) return true

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = n[key]
		if (Array.isArray(arr)) for (const s of arr) if (f(s)) return true
	}

	if (typeof n.additionalProperties === 'object' && f(n.additionalProperties))
		return true

	if (n.patternProperties)
		for (const k in n.patternProperties)
			if (f(n.patternProperties[k])) return true

	for (const key of ['not', 'if', 'then', 'else'] as const)
		if (n[key] && f(n[key])) return true

	return false
}

const hasDefaultBelow = (node: any) => childSchemaSome(node, subtreeHasDefault)

function hasDivergentDefaultBelow(node: any): boolean {
	const ownKey = 'default' in node ? canonical(node.default) : undefined
	let bad = false
	const visit = (n: any): boolean => {
		if (!n || typeof n !== 'object') return false
		if (
			'default' in n &&
			(ownKey === undefined || canonical(n.default) !== ownKey)
		) {
			bad = true
			return true
		}
		return childSchemaSome(n, visit)
	}
	childSchemaSome(node, visit)
	return bad
}

function structuralPreallocatable(schema: any, depth = 0): boolean {
	if (!schema || typeof schema !== 'object') return true

	if (
		!(
			(schema['~kind'] === 'Object' || schema.type === 'object') &&
			!schema['~codec'] &&
			!schema['~refine'] &&
			!Array.isArray(schema.anyOf) &&
			!Array.isArray(schema.allOf) &&
			!Array.isArray(schema.oneOf) &&
			schema.$ref === undefined &&
			schema.if === undefined &&
			schema.not === undefined
		)
	)
		return !hasDivergentDefaultBelow(schema)

	if (depth > 0 && schema.default === undefined && hasDefaultBelow(schema))
		return false

	if (
		typeof schema.additionalProperties === 'object' &&
		subtreeHasDefault(schema.additionalProperties)
	)
		return false

	if (schema.patternProperties)
		for (const k in schema.patternProperties)
			if (subtreeHasDefault(schema.patternProperties[k])) return false

	if (schema.properties)
		for (const k in schema.properties)
			if (!structuralPreallocatable(schema.properties[k], depth + 1))
				return false

	return true
}

function isEmittable(v: unknown, seen: Set<unknown>, top = false): boolean {
	if (v === undefined) return top
	if (v === null) return true
	const t = typeof v
	if (t === 'number') return Number.isFinite(v as number) && !Object.is(v, -0)
	if (t === 'string' || t === 'boolean') return true
	if (t !== 'object') return false
	if (seen.has(v)) return false
	seen.add(v)

	let ok = true
	if (Array.isArray(v)) {
		for (const x of v)
			if (!isEmittable(x, seen)) {
				ok = false
				break
			}
	} else {
		const proto = Object.getPrototypeOf(v)
		if (proto !== Object.prototype && proto !== null) ok = false
		else
			for (const k in v) {
				if (k === '__proto__') {
					ok = false
					break
				}
				if (!Object.prototype.hasOwnProperty.call(v, k)) continue
				if (!isEmittable((v as Record<string, unknown>)[k], seen)) {
					ok = false
					break
				}
			}
	}

	seen.delete(v)
	return ok
}

const PROBE_SENTINEL = '__elysia_default_probe__'

function* defaultProbes(
	pod: Record<string, unknown> | undefined
): Generator<Record<string, unknown>> {
	if (!pod) return
	yield {}
	for (const k in pod) {
		yield { [k]: PROBE_SENTINEL }
		const d = pod[k]
		if (d && typeof d === 'object' && !Array.isArray(d)) {
			yield { [k]: {} }
			for (const k2 in d as Record<string, unknown>) {
				yield { [k]: { [k2]: PROBE_SENTINEL } }
				break
			}
		}
	}
}

function canonical(v: unknown): string {
	if (v === undefined) return '\0u'
	if (Object.is(v, -0)) return '-0'
	if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? '\0u'
	if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'

	return (
		'{' +
		Object.keys(v)
			.sort()
			.map(
				(k) =>
					JSON.stringify(k) +
					':' +
					canonical((v as Record<string, unknown>)[k])
			)
			.join(',') +
		'}'
	)
}

// ? build-time, check if a default is preallocatable (emittable, JSON-serializable)
export function verifyPreallocatableDefault(schema: TSchema) {
	// preallocated default
	let pd: unknown
	// preallocatable object default raw
	let podRaw: unknown

	try {
		pd = Default(schema, undefined)
		podRaw = Default(schema, nullObject())
	} catch {
		return
	}

	const pod =
		podRaw && typeof podRaw === 'object' && !Array.isArray(podRaw)
			? (podRaw as Record<string, unknown>)
			: undefined

	if (
		!isEmittable(pd, new Set(), true) ||
		(pod !== undefined && !isEmittable(pod, new Set(), true))
	)
		return

	if (!isPrecomputeSafe(schema as any)) {
		const s = schema as any

		if (s.type !== 'object' && s['~kind'] !== 'Object') return
		if (!structuralPreallocatable(schema as any)) return

		for (const probe of defaultProbes(pod)) {
			let expected: unknown

			try {
				expected = Default(schema, structuredClone(probe))
			} catch {
				return
			}

			const actual = applyPrecomputed(pod!, structuredClone(probe))
			if (canonical(expected) !== canonical(actual)) return
		}
	}

	return { pd, pod }
}
