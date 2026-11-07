import { Default } from '../typebox-value'
import type { TSchema } from 'typebox/type'

import { EmptyObject, nullObject } from '../../utils'
import { schemaSome } from './clean-safe'
import { isProduction } from '../../universal/is-production'

type DefaultCloner = () => unknown
type ObjectDefaultMerger = (
	value: Record<string, unknown>
) => Record<string, unknown>

function isPrecomputeSafe(schema: any, depth = 0) {
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

// Nested Object with `default` is precompute-safe only when default agrees
// field by field, with the defaults its children would fill in
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
				!Object.hasOwn(own, key) ||
				stableStringify((own as any)[key]) !==
					stableStringify(child.default)
			)
				return true
		} else if (child['~kind'] === 'Object' || child.type === 'object') {
			if (Object.hasOwn(own, key)) {
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v)

// recursive merge precompute default
export function applyPrecomputed(
	defaults: Record<string, unknown>,
	value: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = new EmptyObject()

	// clone in case of a shared reference default value
	for (const k in defaults) {
		if (!Object.hasOwn(defaults, k)) continue
		const d = defaults[k]
		const v = Object.hasOwn(value, k) ? value[k] : undefined

		if (v === undefined)
			out[k] =
				d !== null && typeof d === 'object' ? structuredClone(d) : d
		else if (isRecord(v) && isRecord(d)) out[k] = applyPrecomputed(d, v)
		else out[k] = v
	}

	for (const k in value) {
		if (!Object.hasOwn(value, k) || Object.hasOwn(defaults, k)) continue

		const v = value[k]
		if (v !== undefined) out[k] = v
	}

	return out
}

// `conditional`: a default/ref under if/then/else must still decline precompute
const subtreeHasDefault = (node: any) =>
	schemaSome(node, (n) => 'default' in n, undefined, undefined, true)

const hasDefaultBelow = (node: any) =>
	schemaSome(
		node,
		(n) => n !== node && 'default' in n,
		undefined,
		undefined,
		true
	)

// TypeBox's Default() treats inherited Object.prototype members as present
// values while our merger only reads own keys, so the build-time probe can't
// compare them
const hasPrototypeShadowedDefault = (node: any) =>
	schemaSome(
		node,
		(n) => {
			const properties = n.properties
			if (!properties) return false

			for (const key in properties)
				if (
					Object.hasOwn(properties, key) &&
					Object.hasOwn(Object.prototype, key) &&
					subtreeHasDefault(properties[key])
				)
					return true

			return false
		},
		undefined,
		undefined,
		true
	)

const hasUnemittableDefaultValue = (node: any) =>
	schemaSome(
		node,
		(n) => 'default' in n && !isEmittable(n.default, new Set(), true),
		undefined,
		undefined,
		true
	)

const containsRefLike = (node: any) =>
	schemaSome(
		node,
		(n) =>
			n.$ref !== undefined ||
			n['~kind'] === 'Ref' ||
			n['~kind'] === 'This' ||
			n['~kind'] === 'Cyclic',
		undefined,
		undefined,
		true
	)

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
	) {
		const ownKey =
			'default' in schema ? stableStringify(schema.default) : undefined

		return !schemaSome(
			schema,
			(n) =>
				n !== schema &&
				'default' in n &&
				(ownKey === undefined || stableStringify(n.default) !== ownKey),
			undefined,
			undefined,
			true
		)
	}

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

// `constructor` and `prototype` are inert when emitted through quoted keys and
// bracket assignment. `__proto__` is special object-literal setter syntax.
const isUnsafeEmittedKey = (key: string) => key === '__proto__'

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
					if (isUnsafeEmittedKey(k)) {
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
		if (isUnsafeEmittedKey(k)) return

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

	const guard: string[] = []
	let temps = ''
	let tempCount = 0
	let body = 'const out=Object.create(null);let x;'

	for (const key of keys) {
		const access = JSON.stringify(key)
		const write = `out[${access}]`
		const d = defaults[key]

		const value = cloneExpression(d)
		if (value === undefined) return

		const t = `_v${tempCount++}`
		temps += `const ${t}=Object.hasOwn(v,${access})?v[${access}]:undefined;`

		if (d !== null && typeof d === 'object') {
			if (Array.isArray(d)) {
				body += `if(${t}===undefined)${write}=${value};else ${write}=${t};`
				guard.push(`${t}===undefined`)
				continue
			}

			const nested = buildObjectMergeFunction(
				d as Record<string, unknown>,
				helpers
			)
			if (!nested) return

			body += `if(${t}===undefined)${write}=${value};else if(${t}&&typeof ${t}==='object'&&!Array.isArray(${t}))${write}=${nested}(${t});else ${write}=${t};`
			guard.push(
				`(${t}===undefined||(typeof ${t}==='object'&&${t}!==null&&!Array.isArray(${t})&&${nested}(${t})!==${t}))`
			)
		} else {
			body += `${write}=${t}===undefined?${value}:${t};`
			guard.push(`${t}===undefined`)
		}
	}

	body +=
		'for(const k in v){if(!Object.hasOwn(v,k))continue;x=v[k];if(x!==undefined'
	for (const key of keys) body += `&&k!==${JSON.stringify(key)}`
	body += ')out[k]=x}return out'

	const fastPath = guard.length ? `if(!(${guard.join('||')}))return v;` : ''

	helpers[+name.slice(2)] =
		`function ${name}(v){if(v===null||typeof v!=='object'||Array.isArray(v))return v;${temps}${fastPath}${body}}`

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

let compileFailures = 0

/**
 * How many emitted default-precompute sources have failed to compile.
 *
 * Build-time only. A non-zero count means codegen emitted source that
 * `Function()` rejected, so those routes silently fell back to the interpreted
 * default path — always a bug in this module, never a user error.
 */
export const precomputeCompileFailures = () => compileFailures

// Every caller checks that a source was emitted before reaching here, so a
// throw is never the "declined to emit" case — it is always a codegen bug.
function fromSource<T extends Function>(source: string) {
	try {
		// eslint-disable-next-line sonarjs/code-eval
		return Function(`return ${source}`)() as T
	} catch (error) {
		compileFailures++

		console.warn(
			'[Elysia] default precompute emitted source that does not compile; ' +
				'falling back to the interpreted default path. ' +
				'This is a bug, please report it:',
			error,
			// The source is developer-authored schema defaults, never request
			// data, but a default may still hold a sensitive literal — keep it
			// out of production logs, and truncate since nesting makes it grow.
			...(isProduction()
				? []
				: [
						'\nsource: ' +
							(source.length > 512
								? source.slice(0, 512) + '…'
								: source)
					])
		)
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
	helpers: string[],
	memo: WeakMap<object, string>
):
	| {
			absent: string | undefined
			present: string
			child: string
			isObject: boolean
	  }
	| undefined {
	const full = Default(schema, undefined)
	const child = emitMerger(schema, helpers, memo)
	if (child === undefined) return

	const absent = full === undefined ? undefined : cloneExpression(full)
	if (full !== undefined && absent === undefined) return

	const isObject = mergeCategory(schema) === 'object'

	let present: string
	if (child === '') present = varName
	else if (isObject)
		present = `(${varName}!==null&&typeof ${varName}==='object'&&!Array.isArray(${varName})?${child}(${varName}):${varName})`
	else present = `(Array.isArray(${varName})?${child}(${varName}):${varName})`

	return { absent, present, child, isObject }
}

function emitMerger(
	node: any,
	helpers: string[],
	memo: WeakMap<object, string> = new WeakMap()
) {
	if (memo.has(node)) return memo.get(node)!

	const category = mergeCategory(node)
	if (category === 'identity') return ''
	if (category === 'bail') return

	const name = `_d${helpers.length}`
	helpers.push('')

	memo.set(node, name)

	if (category === 'object') {
		const props = node.properties ?? nullObject()
		const handled: string[] = []

		const typeGuard =
			"if(v===null||typeof v!=='object'||Array.isArray(v))return v;"
		let tempDecls = 'let x;'

		const guard: string[] = []
		let mergeBody = 'const out=Object.create(null);'

		let tempCount = 0

		for (const key in props) {
			if (!Object.hasOwn(props, key)) continue
			const ps = props[key]
			if (!subtreeHasDefault(ps)) continue
			if (isUnsafeEmittedKey(key)) return

			const expr = mergeExpression(ps, 'x', helpers, memo)
			if (!expr) return

			handled.push(key)
			const access = JSON.stringify(key)
			const vk = `v[${access}]`
			const n = tempCount++
			const value = `_v${n}`
			tempDecls += `let ${value}=Object.hasOwn(v,${access})?${vk}:undefined;`

			const absentTest =
				expr.absent === undefined ? undefined : `${value}===undefined`

			if (expr.child !== '') {
				// Compute the merged result once into a temp variable.
				const tmp = `_t${n}`
				const typeCheck = expr.isObject
					? `${value}!==null&&typeof ${value}==='object'&&!Array.isArray(${value})`
					: `Array.isArray(${value})`

				tempDecls += `let ${tmp}=${typeCheck}?${expr.child}(${value}):${value};`

				const presentTest = `(${value}!==undefined&&${tmp}!==${value})`
				const test = [absentTest, presentTest]
					.filter(Boolean)
					.join('||')
				if (test) guard.push(test)

				mergeBody +=
					expr.absent === undefined
						? `if(${value}!==undefined)out[${access}]=${tmp};`
						: `out[${access}]=${value}===undefined?${expr.absent}:${tmp};`
			} else {
				// Identity child, no merger call so retain the original approach
				mergeBody += `x=${value};`
				mergeBody +=
					expr.absent === undefined
						? `if(x!==undefined)out[${access}]=${expr.present};`
						: `out[${access}]=x===undefined?${expr.absent}:${expr.present};`

				if (absentTest) guard.push(absentTest)
			}
		}

		if (!handled.length) {
			helpers.pop()
			return ''
		}

		mergeBody +=
			'for(const k in v){if(!Object.hasOwn(v,k))continue;x=v[k];if(x!==undefined'
		for (const key of handled) mergeBody += `&&k!==${JSON.stringify(key)}`
		mergeBody += ')out[k]=x}return out'

		const fastPath = guard.length
			? `if(!(${guard.join('||')}))return v;`
			: ''

		helpers[+name.slice(2)] =
			`function ${name}(v){${typeGuard}${tempDecls}${fastPath}${mergeBody}}`
		return name
	}

	const expr = mergeExpression(node.items, 'e', helpers, memo)
	if (!expr) return

	if (expr.absent === undefined && expr.present === 'e') {
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

// Build-time differential probes (empty containers, sentinel fills) live in
// build-only `src/compile/aot-capture.ts`
export interface DefaultProbeImpl {
	validateMergeSource(schema: TSchema, source: string): boolean
	validateObjectDefault(
		schema: TSchema,
		pod: Record<string, unknown>
	): boolean
}

let probeImpl: DefaultProbeImpl | undefined

export function setDefaultProbeImpl(impl: DefaultProbeImpl) {
	probeImpl = impl
}

function probe() {
	if (!probeImpl)
		throw new Error(
			'[Elysia] validating a preallocatable default requires the ' +
				'build-only AOT capture module (src/compile/aot-capture)'
		)

	return probeImpl
}

export function stableStringify(v: unknown): string {
	if (v === undefined) return '\0u'
	if (Object.is(v, -0)) return '-0'
	if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? '\0u'
	if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'

	return (
		'{' +
		Object.keys(v)
			.sort()
			.map(
				(k) =>
					JSON.stringify(k) +
					':' +
					stableStringify((v as Record<string, unknown>)[k])
			)
			.join(',') +
		'}'
	)
}

// ? build-time, check if a default is preallocatable (emittable, JSON-serializable)
export function verifyPreallocatableDefault(schema: TSchema, validate = true) {
	if (hasUnemittableDefaultValue(schema)) return
	const ownDefaultSemantics = hasPrototypeShadowedDefault(schema)

	// preallocated default
	let pd: unknown
	// preallocatable object default raw
	let podRaw: unknown

	try {
		pd = Default(schema, undefined)
		podRaw = Default(schema, nullObject())

		if (ownDefaultSemantics) {
			const rootDefault = (schema as any).default
			const source =
				Object.hasOwn(schema, 'default') && isRecord(rootDefault)
					? rootDefault
					: pd

			if (isRecord(source) && isRecord(podRaw))
				pd = structuredClone(applyPrecomputed(podRaw, source))
		}
	} catch {
		return
	}

	const s = schema as any
	const rootIsObject = s.type === 'object' || s['~kind'] === 'Object'

	const pod =
		rootIsObject &&
		isRecord(podRaw) &&
		// empty pod = no present-object defaults → passthrough, not a no-op copy
		Object.keys(podRaw).length !== 0
			? podRaw
			: undefined

	if (containsRefLike(schema)) return

	if (
		!isEmittable(pd, new Set(), true) ||
		(pod !== undefined && !isEmittable(pod, new Set(), true))
	)
		return

	const nullDefault = isPrecomputeSafe(schema as any)

	let ms: string | undefined
	const category = mergeCategory(schema)
	if (category === 'object' || category === 'array') {
		const helpers: string[] = []
		const root = emitMerger(schema, helpers)
		if (root) ms = `(function(){${helpers.join(';')};return ${root}})()`
	}

	if (
		ms !== undefined &&
		validate &&
		!(ownDefaultSemantics
			? createMergerFromSource(ms)
			: probe().validateMergeSource(schema, ms))
	)
		ms = undefined

	if (!nullDefault && ms === undefined) {
		if (!rootIsObject) return
		if (!structuralPreallocatable(schema as any)) return

		if (
			validate &&
			!ownDefaultSemantics &&
			pod !== undefined &&
			!probe().validateObjectDefault(schema, pod)
		)
			return
	}

	return { pd, pn: nullDefault, pod, ms }
}
