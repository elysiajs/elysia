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
	// non-object / array / null inputs pass straight through, matching
	// `Default(objectSchema, nonObject) === nonObject` (the runtime dispatch no
	// longer pre-filters array input, so the merger must self-guard)
	let body =
		"if(v===null||typeof v!=='object'||Array.isArray(v))return v;const out=Object.create(null);let x;"

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

// Compile a schema-driven merger source (`ms`) for the non-AOT runtime path, so
// it makes the exact same merge decision the frozen manifest baked.
export function createMergerFromSource(source: string) {
	return fromSource<(value: any) => any>(source)
}

type MergeCategory = 'identity' | 'object' | 'array' | 'bail'

function mergeCategory(node: any): MergeCategory {
	if (!node || typeof node !== 'object') return 'identity'
	if (!subtreeHasDefault(node)) return 'identity'
	if (node['~codec'] || node['~refine']) return 'bail'

	const kind = node['~kind']
	if (
		kind === 'Union' ||
		kind === 'Intersect' ||
		kind === 'Ref' ||
		kind === 'This' ||
		kind === 'Cyclic'
	)
		return 'bail'

	if (kind === 'Object' || node.type === 'object') return 'object'

	if ((kind === 'Array' || node.type === 'array') && node.items)
		return !Array.isArray(node.items) && subtreeHasDefault(node.items)
			? 'array'
			: 'identity'

	return 'identity'
}

function mergeExpression(
	schema: any,
	varName: string,
	helpers: string[]
): { absent: string | undefined; present: string } | undefined {
	const full = Default(schema, undefined)
	const child = emitMerger(schema, helpers)
	if (child === undefined) return

	const absent = full === undefined ? undefined : cloneExpression(full)
	if (full !== undefined && absent === undefined) return

	let present: string
	if (child === '') present = varName
	else
		present =
			mergeCategory(schema) === 'object'
				? `(${varName}!==null&&typeof ${varName}==='object'&&!Array.isArray(${varName})?${child}(${varName}):${varName})`
				: `(Array.isArray(${varName})?${child}(${varName}):${varName})`

	return { absent, present }
}

function emitMerger(node: any, helpers: string[]) {
	const category = mergeCategory(node)
	if (category === 'identity') return ''
	if (category === 'bail') return

	const name = `_d${helpers.length}`
	helpers.push('')

	if (category === 'object') {
		const props = node.properties ?? {}
		const handled: string[] = []

		// non-object / array / null inputs pass straight through, matching
		// `Default(objectSchema, nonObject) === nonObject`
		let body =
			"if(v===null||typeof v!=='object'||Array.isArray(v))return v;const out=Object.create(null);let x;"

		for (const key in props) {
			if (!Object.hasOwn(props, key)) continue
			const ps = props[key]
			if (!subtreeHasDefault(ps)) continue
			if (dangerousKeys.has(key)) return

			const expr = mergeExpression(ps, 'x', helpers)
			if (!expr) return

			handled.push(key)
			const access = JSON.stringify(key)
			body += `x=v[${access}];`
			body +=
				expr.absent === undefined
					? `if(x!==undefined)out[${access}]=${expr.present};`
					: `out[${access}]=x===undefined?${expr.absent}:${expr.present};`
		}

		// object default with no fillable child
		if (!handled.length) {
			helpers.pop()
			return ''
		}

		body += 'for(const k in v){x=v[k];if(x!==undefined'
		for (const key of handled) body += `&&k!==${JSON.stringify(key)}`
		body += ')out[k]=x}return out'

		helpers[+name.slice(2)] = `function ${name}(v){${body}}`
		return name
	}

	// array: map the element merger over each element
	const expr = mergeExpression(node.items, 'e', helpers)
	if (!expr) return

	if (expr.absent === undefined && expr.present === 'e') {
		// element needs no merging — drop the no-op map
		helpers.pop()
		return ''
	}

	const assign =
		expr.absent === undefined
			? `e===undefined?undefined:${expr.present}`
			: `e===undefined?${expr.absent}:${expr.present}`

	helpers[+name.slice(2)] =
		`function ${name}(v){if(!Array.isArray(v))return v;` +
		`const o=new Array(v.length);let e;` +
		`for(let i=0;i<v.length;i++){e=v[i];o[i]=${assign}}return o}`

	return name
}

export function buildMergeSource(schema: any) {
	const category = mergeCategory(schema)
	if (category !== 'object' && category !== 'array') return

	const helpers: string[] = []
	const root = emitMerger(schema, helpers)
	if (!root) return

	return `(function(){${helpers.join(';')};return ${root}})()`
}

// Forces every nested object/array default to fill at once
// object slots -> `{}`
// array slots -> `[<empty element>]`
// scalars left empty
function emptyContainers(node: any, depth: number): unknown {
	if (depth <= 0 || !node || typeof node !== 'object') return
	const kind = node['~kind']

	if (kind === 'Object' || node.type === 'object') {
		const out: Record<string, unknown> = nullObject()

		const props = node.properties ?? {}
		for (const key in props)
			if (Object.hasOwn(props, key)) {
				const child = emptyContainers(props[key], depth - 1)
				if (child !== undefined) out[key] = child
			}
		return out
	}

	if ((kind === 'Array' || node.type === 'array') && node.items && !Array.isArray(node.items)) {
		const element = emptyContainers(node.items, depth - 1)
		return element === undefined ? [] : [element]
	}
}

// Build-time probes for `validateMergeSource`: empty containers, a fully-nested
// fill, and a present sentinel at each top-level slot (passthrough must not be
// clobbered by a default).
function* mergeProbes(schema: any): Generator<unknown> {
	yield {}
	yield []

	const filled = emptyContainers(schema, 6)
	if (filled !== undefined) yield filled

	const kind = schema['~kind']
	if (kind === 'Object' || schema.type === 'object') {
		const props = schema.properties ?? {}
		for (const key in props)
			if (Object.hasOwn(props, key)) {
				yield { [key]: PROBE_SENTINEL }
				const child = emptyContainers(props[key], 6)
				if (child !== undefined) yield { [key]: child }
			}
	} else if (
		(kind === 'Array' || schema.type === 'array') &&
		schema.items &&
		!Array.isArray(schema.items)
	) {
		yield [PROBE_SENTINEL]
		const element = emptyContainers(schema.items, 6)
		if (element !== undefined) yield [element, element]
	}
}

function validateMergeSource(schema: TSchema, source: string): boolean {
	const merger = fromSource<(value: unknown) => unknown>(source)
	if (!merger) return false

	for (const probe of mergeProbes(schema)) {
		// the runtime only invokes the merger for present, non-null object/array
		if (probe === null || typeof probe !== 'object') continue

		let expected: unknown
		try {
			expected = Default(schema, structuredClone(probe))
		} catch {
			return false
		}

		let actual: unknown
		try {
			actual = merger(structuredClone(probe))
		} catch {
			return false
		}

		if (canonical(expected) !== canonical(actual)) return false
	}

	return true
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
export function verifyPreallocatableDefault(schema: TSchema, validate = true) {
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

	const s = schema as any
	const rootIsObject = s.type === 'object' || s['~kind'] === 'Object'

	const pod =
		rootIsObject &&
		podRaw &&
		typeof podRaw === 'object' &&
		!Array.isArray(podRaw)
			? (podRaw as Record<string, unknown>)
			: undefined

	if (containsRefLike(schema)) return

	if (
		!isEmittable(pd, new Set(), true) ||
		(pod !== undefined && !isEmittable(pod, new Set(), true))
	)
		return

	const nullDefault = isPrecomputeSafe(schema as any)

	let ms = buildMergeSource(schema)
	if (ms !== undefined && validate && !validateMergeSource(schema, ms))
		ms = undefined

	if (!nullDefault && ms === undefined) {
		if (!rootIsObject) return
		if (!structuralPreallocatable(schema as any)) return

		if (validate)
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

	return { pd, pn: nullDefault, pod, ms }
}
