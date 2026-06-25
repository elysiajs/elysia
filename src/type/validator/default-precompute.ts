import { Default } from 'typebox/value'
import type { TSchema } from 'typebox/type'

import { nullObject } from '../../utils'
import { dangerousKeys } from '../../constants'

type DefaultCloner = () => unknown
type ObjectDefaultMerger = (
	value: Record<string, unknown>
) => Record<string, unknown>

export function isPrecomputeSafe(schema: any, depth = 0) {
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
// own default agrees, field by field, with the defaults its children would fill in
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
		const v = value[k]

		if (v === undefined)
			out[k] =
				d !== null && typeof d === 'object' ? structuredClone(d) : d
		else if (!Object.hasOwn(value, k))
			// Preserve TypeBox exotic keys like "constructor"
			// while avoiding reuse of the shared default object
			out[k] = v
		else out[k] = d
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

const subtreeHasDefault = (n: any) =>
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

function hasUnemittableDefaultValue(node: any): boolean {
	if (!node || typeof node !== 'object') return false

	if ('default' in node && !isEmittable(node.default, new Set(), true))
		return true

	return childSchemaSome(node, hasUnemittableDefaultValue)
}

function containsRefLike(node: any, seen = new WeakSet()): boolean {
	if (!node || typeof node !== 'object' || seen.has(node)) return false
	seen.add(node)

	if (
		node.$ref !== undefined ||
		node['~kind'] === 'Ref' ||
		node['~kind'] === 'This' ||
		node['~kind'] === 'Cyclic'
	)
		return true

	return childSchemaSome(node, (child) => containsRefLike(child, seen))
}

function hasDivergentDefaultBelow(node: any) {
	const ownKey = 'default' in node ? canonical(node.default) : undefined
	let bad = false

	const visit = (n: any) => {
		if (!n || typeof n !== 'object') return false
		if (
			'default' in n &&
			(ownKey === undefined || canonical(n.default) !== ownKey)
		)
			return (bad = true)

		return childSchemaSome(n, visit)
	}

	childSchemaSome(node, visit)

	return bad
}

function structuralPreallocatable(schema: any, depth = 0) {
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

function emittableObjectKeys(v: object): string[] | undefined {
	if (Object.getOwnPropertySymbols(v).length) return

	const keys = Object.keys(v)
	if (Object.getOwnPropertyNames(v).length !== keys.length) return

	for (const k of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(v, k)
		if (
			!descriptor ||
			descriptor.get ||
			descriptor.set ||
			!descriptor.enumerable
		)
			return
	}

	return keys
}

export function isEmittable(
	v: unknown,
	seen: Set<unknown>,
	top = false
): boolean {
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
		if (Object.getOwnPropertySymbols(v).length) ok = false
		for (const x of v)
			if (!isEmittable(x, seen)) {
				ok = false
				break
			}
	} else {
		const proto = Object.getPrototypeOf(v)
		if (proto !== Object.prototype && proto !== null) ok = false
		else {
			const keys = emittableObjectKeys(v)

			if (!keys) ok = false
			else
				for (const k of keys) {
					if (dangerousKeys.has(k)) {
						ok = false
						break
					}

					if (!isEmittable((v as Record<string, unknown>)[k], seen)) {
						ok = false
						break
					}
				}
		}
	}

	seen.delete(v)
	return ok
}

function cloneExpression(v: unknown): string | undefined {
	if (v === undefined) return 'undefined'
	if (v === null) return 'null'

	const t = typeof v
	if (t === 'number' || t === 'string' || t === 'boolean')
		return JSON.stringify(v)

	if (t !== 'object') return

	if (Array.isArray(v)) {
		if (Object.getOwnPropertySymbols(v).length) return
		const values: string[] = []
		for (const x of v) {
			const value = cloneExpression(x)
			if (value === undefined) return
			values.push(value)
		}

		return '[' + values.join(',') + ']'
	}

	const proto = Object.getPrototypeOf(v)
	if (proto !== Object.prototype && proto !== null) return
	const keys = emittableObjectKeys(v)
	if (!keys) return

	const entries: string[] = []
	for (const k of keys) {
		if (dangerousKeys.has(k)) return

		const value = cloneExpression((v as Record<string, unknown>)[k])
		if (value === undefined) return

		entries.push(JSON.stringify(k) + ':' + value)
	}

	return '{' + entries.join(',') + '}'
}

export function buildDefaultClonerSource(value: unknown) {
	if (!isEmittable(value, new Set(), true)) return

	const expression = cloneExpression(value)
	if (expression === undefined) return

	return `function(){return ${expression}}`
}

function buildObjectMergeFunction(
	defaults: Record<string, unknown>,
	helpers: string[]
) {
	const name = `_m${helpers.length}`
	helpers.push('')

	const keys = Object.keys(defaults)
	let body = 'const out=Object.create(null);let x;'

	for (const key of keys) {
		const access = `v[${JSON.stringify(key)}]`
		const write = `out[${JSON.stringify(key)}]`
		const d = defaults[key]
		const value = cloneExpression(d)
		if (value === undefined) return

		body += `x=${access};`

		if (d !== null && typeof d === 'object') {
			if (Array.isArray(d)) {
				body += `if(x===undefined)${write}=${value};else ${write}=x;`
				continue
			}

			const nested = buildObjectMergeFunction(
				d as Record<string, unknown>,
				helpers
			)
			if (!nested) return

			body += `if(x===undefined)${write}=${value};else if(x&&typeof x==='object'&&!Array.isArray(x))${write}=${nested}(x);else ${write}=x;`
		} else body += `${write}=x===undefined?${value}:x;`
	}

	body += 'for(const k in v){x=v[k];if(x!==undefined'
	for (const key of keys) body += `&&k!==${JSON.stringify(key)}`
	body += ')out[k]=x}return out'

	helpers[+name.slice(2)] = `function ${name}(v){${body}}`

	return name
}

export function buildObjectDefaultMergeSource(
	defaults: Record<string, unknown>
) {
	if (!isEmittable(defaults, new Set(), true)) return

	const helpers: string[] = []
	const root = buildObjectMergeFunction(defaults, helpers)
	if (!root) return

	return `(function(){${helpers.join(';')};return ${root}})()`
}

function fromSource<T extends Function>(source: string) {
	try {
		// eslint-disable-next-line sonarjs/code-eval
		return Function(`return ${source}`)() as T
	} catch {
		return
	}
}

export function createDefaultCloner(value: unknown) {
	const source = buildDefaultClonerSource(value)

	return source ? fromSource<DefaultCloner>(source) : undefined
}

export function createObjectDefaultMerger(defaults: Record<string, unknown>) {
	const source = buildObjectDefaultMergeSource(defaults)

	return source ? fromSource<ObjectDefaultMerger>(source) : undefined
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
	if (hasUnemittableDefaultValue(schema)) return

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

	// Raw refs depend on TypeBox Module/$ref resolution semantics. Do not try to
	// precompute through them; named Elysia model refs are already resolved before
	// this point and will appear here as concrete schemas.
	if (containsRefLike(schema)) return

	if (
		!isEmittable(pd, new Set(), true) ||
		(pod !== undefined && !isEmittable(pod, new Set(), true))
	)
		return

	const nullDefault = isPrecomputeSafe(schema as any)

	if (!nullDefault) {
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

	return { pd, pn: nullDefault, pod }
}
