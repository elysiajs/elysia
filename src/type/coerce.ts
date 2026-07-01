import type { TProperties, TSchema, TSchemaOptions } from 'typebox'

import type { BaseSchema } from '.'
import { ELYSIA_TYPES, primitiveElysiaTypes } from './constants'

import { ArrayString } from './elysia/array-string'
import { ObjectString } from './elysia/object-string'
import { Numeric } from './elysia/numeric'
import { BooleanString } from './elysia/boolean-string'
import { IntegerString } from './elysia/integer-string'
import { nullObject } from '../utils'

interface CoerceOptions {
	/**
	 * Replace root
	 *
	 * - `true`: Replace only schema on root level
	 * - `false`: Replace schema NOT on root level
	 * - `undefined`: Replace all schemas regardless of level
	 */
	root?: boolean | undefined
	/**
	 * Replace only the first specified type found
	 **/
	onlyFirst?: 'object' | 'array' | (string & {})
	/**
	 * Traverse until object is found except root object
	 **/
	untilNonRootObjectFound?: boolean
	/**
	 * Only root object
	 */
	rootPropertiesOnly?: boolean
}

// The replacement factory receives the ORIGINAL schema node, which doubles
// as the options bag (constraints like `minimum` carry over to the new type)
type CoerceTo = (
	schema: BaseSchema & TSchemaOptions
) => TSchema | BaseSchema | null

/**
 * Replace schema types with custom transformation
 */
export function coerce(
	schema: BaseSchema | TSchema,
	fromTo: [from: string, to: CoerceTo][],
	options?: CoerceOptions
): BaseSchema {
	const transformMap = new Map<string, CoerceTo>()
	for (const [from, to] of fromTo)
		if (!transformMap.has(from)) transformMap.set(from, to)
	const rootOption = options?.root

	const memo = new WeakMap<BaseSchema, BaseSchema | null>()
	let stopped = false

	function walk(
		node: BaseSchema,
		isRoot: boolean,
		isRootProperty = false
	): BaseSchema {
		if (
			!node ||
			stopped ||
			typeof node !== 'object' ||
			(node['~elyTyp'] &&
				primitiveElysiaTypes.has(node['~elyTyp'] as any))
		)
			return node

		const memoed = memo.get(node)
		if (memoed !== undefined) return memoed ?? node

		// Early exit if we're deeper than root properties
		if (options?.rootPropertiesOnly && !isRoot && !isRootProperty)
			return node

		memo.set(node, null)

		const kind = node['~kind'] as string | undefined

		if (
			options?.untilNonRootObjectFound &&
			!isRoot &&
			(kind === 'Object' || kind === 'Array')
		)
			return node

		const canReplace =
			rootOption === undefined ||
			(rootOption === true && isRoot) ||
			(rootOption === false && !isRoot)

		// Skip transforming root itself when rootPropertiesOnly
		const skipRootTransform = options?.rootPropertiesOnly && isRoot

		if (canReplace && kind && !skipRootTransform) {
			const to = transformMap.get(kind)
			if (to) {
				const { type, ...rest } = node
				let result = to(rest)
				if (result !== null) {
					if (options?.onlyFirst === kind) stopped = true

					if ('~optional' in node) {
						if (Object.isFrozen(result))
							result = Object.defineProperty(
								Object.create(result),
								'~optional',
								{
									value: node['~optional'],
									enumerable: false
								}
							)
						else
							Object.defineProperty(result, '~optional', {
								value: node['~optional'],
								enumerable: false
							})
					}

					memo.set(node, result! as BaseSchema)
					return result! as BaseSchema
				}
			}
		}

		if (stopped) return node

		if (options?.rootPropertiesOnly && isRootProperty) {
			let out: any = node
			for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
				const arr = node[key]
				if (!Array.isArray(arr)) continue
				let newArr: BaseSchema[] | undefined
				for (let i = 0, len = arr.length; i < len; i++) {
					const item = arr[i]!
					const r = walk(item, false, true)
					if (stopped && !newArr) {
						memo.set(node, node)
						return node
					}
					if (r !== item) {
						newArr ??= arr.slice()
						newArr[i] = r
					}
				}
				if (newArr) {
					out = cloneNode(node, out)
					out[key] = newArr
				}
			}

			if (node.items) {
				const items = node.items
				if (Array.isArray(items)) {
					let newItems: BaseSchema[] | undefined
					for (let i = 0, len = items.length; i < len; i++) {
						const r = walk(items[i]!, false, true)
						if (r !== items[i]) {
							newItems ??= items.slice()
							newItems[i] = r
						}
					}
					if (newItems) {
						out = cloneNode(node, out)
						out.items = newItems
					}
				} else {
					const r = walk(items, false, true)
					if (r !== items) {
						out = cloneNode(node, out)
						out.items = r
					}
				}
			}

			memo.set(node, out)
			return out
		}

		let out: any = node

		// Combinators
		for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
			const arr = node[key]
			if (!Array.isArray(arr)) continue

			let newArr: BaseSchema[] | undefined
			for (let i = 0, len = arr.length; i < len; i++) {
				const item = arr[i]!
				const r = walk(item, false)

				if (stopped && !newArr) return node

				if (r !== item) {
					newArr ??= arr.slice()
					newArr[i] = r
				}
			}

			if (newArr) {
				out = cloneNode(node, out)
				out[key] = newArr
			}
		}

		// Not
		if (node.not) {
			const r = walk(node.not, false)
			if (r !== node.not) {
				out = cloneNode(node, out)
				out.not = r
			}
		}

		// Items (array or tuple)
		if (node.items) {
			const items = node.items
			if (Array.isArray(items)) {
				let newItems: BaseSchema[] | undefined
				for (let i = 0, len = items.length; i < len; i++) {
					const item = items[i]!
					const r = walk(item, false)
					if (r !== item) {
						newItems ??= items.slice()
						newItems[i] = r
					}
				}

				if (newItems) {
					out = cloneNode(node, out)
					out.items = newItems
				}
			} else {
				const r = walk(items, false)
				if (r !== items) {
					out = cloneNode(node, out)
					out.items = r
				}
			}
		}

		if (node.properties) {
			let newProps: Record<string, BaseSchema> | undefined
			const props = node.properties
			const childIsRootProp = options?.rootPropertiesOnly && isRoot

			for (const k in props) {
				const v = props[k]!
				const r = walk(v, false, childIsRootProp)
				if (r !== v) {
					newProps ??= { ...props }
					newProps[k] = r
				}
			}

			if (newProps) {
				out = cloneNode(node, out)
				out.properties = newProps
			}
		}

		if (typeof node.additionalProperties === 'object') {
			const r = walk(node.additionalProperties, false)
			if (r !== node.additionalProperties) {
				out = cloneNode(node, out)
				out.additionalProperties = r
			}
		}

		// Record (patternProperties)
		if (node.patternProperties) {
			let newPP: Record<string, BaseSchema> | undefined
			const patternProps = node.patternProperties

			for (const k in patternProps) {
				const v = patternProps[k]!
				const r = walk(v, false)
				if (r !== v) {
					newPP ??= { ...patternProps }
					newPP[k] = r
				}
			}

			if (newPP) {
				out = cloneNode(node, out)
				out.patternProperties = newPP
			}
		}

		if (kind === 'Cyclic') {
			const def = node.$defs![
				node.$ref as keyof typeof node.$defs
			] as unknown as BaseSchema | undefined

			if (def) {
				const r = walk(def, false)
				if (r !== def) {
					out = cloneNode(node, out)
					out.$defs = { ...node.$defs, [node.$ref!]: r }
				}
			}
		}

		memo.set(node, out)
		return out
	}

	return walk(schema as BaseSchema, true)
}

type CoerceParameters = Parameters<typeof coerce>
export type CoerceOption =
	| [CoerceParameters[1]]
	| [CoerceParameters[1], CoerceParameters[2]]

let _coerceRoot: CoerceOption[]
export const coerceRoot = () =>
	(_coerceRoot ??= [
		[
			[
				['Number', Numeric],
				['Boolean', BooleanString],
				['Integer', IntegerString]
			],
			{
				rootPropertiesOnly: true
			}
		]
	])

const toObjectString = (x: BaseSchema & TSchemaOptions) =>
	ObjectString((x.properties as TProperties) ?? {}, x)

const toArrayString = (x: BaseSchema & TSchemaOptions) =>
	ArrayString((x.items ?? {}) as any, x)

let _coerceQuery: CoerceOption[]
export const coerceQuery = () =>
	(_coerceQuery ??= [
		[
			[
				['Object', toObjectString],
				['Array', toArrayString]
			],
			{
				root: false
			}
		],
		...coerceRoot()
	])

let _coerceBody: CoerceOption[]
export const coerceBody = () =>
	(_coerceBody ??= [
		[
			[
				['Number', Numeric],
				['Boolean', BooleanString]
			],
			{ root: true }
		],
		// Integer everywhere: no `root` filter, no `rootPropertiesOnly`.
		[[['Integer', IntegerString]]]
	])

let _coerceFormData: CoerceOption[]
export const coerceFormData = () =>
	(_coerceFormData ??= [
		[
			[['Object', toObjectString]],
			{
				rootPropertiesOnly: true
			}
		],
		[
			[['Array', toArrayString]],
			{
				root: false,
				onlyFirst: 'array'
			}
		]
	])

// headers, params
let _coerceStringToStructure: CoerceOption[]
export const coerceStringToStructure = () =>
	(_coerceStringToStructure ??= [
		[
			[
				['Object', toObjectString],
				['Array', toArrayString]
			],
			{
				rootPropertiesOnly: true
			}
		],
		...coerceRoot()
	])

export function applyCoercions(
	schema: BaseSchema | TSchema,
	coerces: CoerceOption[] | undefined
) {
	if (coerces)
		for (const coercion of coerces)
			schema = coerce(schema, coercion[0], coercion[1])

	return schema
}

const COERCE_LEAF_CTOR = {
	[ELYSIA_TYPES.Numeric]: Numeric,
	[ELYSIA_TYPES.Integer]: IntegerString,
	[ELYSIA_TYPES.BooleanString]: BooleanString
} as const

export interface CoerceLeaf {
	// `~elyTyp` of the primitive coercion
	e: number
	// constraints bag passed to the leaf constructor (own-enumerable, minus `type`)
	c?: Record<string, unknown>
	// `~optional` marker to re-attach (coercion preserves it; the shared leaf can't)
	o?: unknown
}

export interface CoerceObjStr {
	// `~elyTyp`: ObjectString or ArrayString
	os: number
	// `~optional` marker to re-attach (symmetric with CoerceLeaf.o)
	o?: unknown
}

type CoerceNode = CoerceLeaf | CoerceObjStr | CoercePlan

export interface CoercePlan {
	// per-property coercion (key → leaf / objstr / nested plan)
	p?: Record<string, CoerceNode>
	// single-schema array items coercion
	i?: CoerceNode
}

const isCoerceLeaf = (x: CoerceNode): x is CoerceLeaf =>
	typeof (x as CoerceLeaf).e === 'number'

const isCoerceObjStr = (x: CoerceNode): x is CoerceObjStr =>
	typeof (x as CoerceObjStr).os === 'number'

export function captureCoercePlan(
	original: any,
	coerced: any
): CoercePlan | null {
	let bakeable = true
	let any = false

	const walk = (o: any, c: any): CoerceNode | null => {
		if (o === c || !c || typeof c !== 'object') return null

		const ely = c['~elyTyp']

		if (
			(ely === ELYSIA_TYPES.ObjectString ||
				ely === ELYSIA_TYPES.ArrayString) &&
			(!o || o['~elyTyp'] !== ely)
		) {
			any = true
			const site: CoerceObjStr = { os: ely }
			if (o && '~optional' in o) site.o = o['~optional']
			return site
		}

		// @ts-expect-error
		if (ely && COERCE_LEAF_CTOR[ely] && (!o || o['~elyTyp'] !== ely)) {
			any = true

			const leaf: CoerceLeaf = { e: ely }

			if (o) {
				const { type, ...rest } = o
				if (Object.keys(rest).length) leaf.c = rest

				if ('~optional' in o) leaf.o = o['~optional']
			}

			return leaf
		}

		if (
			(Array.isArray(c.anyOf) &&
				c.anyOf.some((b: any, i: number) => b !== o?.anyOf?.[i])) ||
			(Array.isArray(c.allOf) &&
				c.allOf.some((b: any, i: number) => b !== o?.allOf?.[i])) ||
			(Array.isArray(c.oneOf) &&
				c.oneOf.some((b: any, i: number) => b !== o?.oneOf?.[i])) ||
			(Array.isArray(c.items) &&
				c.items.some((b: any, i: number) => b !== o?.items?.[i])) ||
			(c.not && c.not !== o?.not) ||
			(c.additionalProperties &&
				typeof c.additionalProperties === 'object' &&
				c.additionalProperties !== o?.additionalProperties)
		) {
			bakeable = false
			return null
		}

		const plan: CoercePlan = nullObject()

		if (c.properties && o?.properties)
			for (const k in c.properties) {
				const sub = walk(o.properties[k], c.properties[k])
				if (sub) (plan.p ??= nullObject())[k] = sub
			}

		if (
			c.items &&
			!Array.isArray(c.items) &&
			o?.items &&
			!Array.isArray(o.items)
		) {
			const sub = walk(o.items, c.items)
			if (sub) plan.i = sub
		}

		return plan.p || plan.i ? plan : null
	}

	const plan = walk(original, coerced)

	if (
		!bakeable ||
		!any ||
		!plan ||
		isCoerceLeaf(plan) ||
		isCoerceObjStr(plan)
	)
		return null

	if (!jsonSafe(plan)) return null

	return plan
}

// the plan is emitted as JSON; bail if a value won't survive the round-trip
// (Infinity/NaN → null, fn/symbol dropped), `undefined` is rejected on purpose
function jsonSafe(value: unknown) {
	if (value === null) return true

	const t = typeof value
	if (t === 'number') return Number.isFinite(value as number)
	if (t === 'string' || t === 'boolean') return true
	if (t !== 'object') return false

	if (Array.isArray(value)) return value.every(jsonSafe)
	for (const k in value as object)
		if (!jsonSafe((value as any)[k])) return false

	return true
}

function rebuildObjStr(original: any, site: CoerceObjStr) {
	const { type, ...rest } = original
	const node =
		site.os === ELYSIA_TYPES.ObjectString
			? toObjectString(rest as any)
			: toArrayString(rest as any)

	if ('o' in site)
		return Object.defineProperty(node, '~optional', {
			value: site.o,
			enumerable: false
		})

	return node
}

const buildCoerceNode = (original: any, node: CoerceNode) =>
	isCoerceLeaf(node)
		? coerceLeaf(node)
		: isCoerceObjStr(node)
			? rebuildObjStr(original, node)
			: buildCoercedFromPlan(original, node)

const coerceLeafCache = new Map<string, any>()

function coerceLeaf(leaf: CoerceLeaf): any {
	const key = leaf.e + (leaf.c ? JSON.stringify(leaf.c) : '')
	let node = coerceLeafCache.get(key)
	if (node === undefined) {
		// @ts-expect-error
		node = COERCE_LEAF_CTOR[leaf.e]!(leaf.c)
		coerceLeafCache.set(key, node)
	}

	// per-use `~optional` wrapper (don't mutate the shared frozen leaf)
	if ('o' in leaf)
		return Object.defineProperty(Object.create(node), '~optional', {
			value: leaf.o,
			enumerable: false
		})

	return node
}

export function buildCoercedFromPlan(original: any, plan: CoercePlan) {
	const out = Object.create(Object.getPrototypeOf(original))

	for (const k in original) out[k] = original[k]
	// copy non-enumerable property
	for (const s of Object.getOwnPropertyNames(original)) {
		const d = Object.getOwnPropertyDescriptor(original, s)!
		if (!d.enumerable) Object.defineProperty(out, s, d)
	}

	if (plan.p) {
		const props: Record<string, unknown> = { ...original.properties }
		for (const k in plan.p)
			props[k] = buildCoerceNode(original.properties[k], plan.p[k]!)
		out.properties = props
	}

	if (plan.i) out.items = buildCoerceNode(original.items, plan.i)

	return out
}

/** @internal test isolation */
export function clearCoerceLeafCache() {
	coerceLeafCache.clear()
}

const noEnumerable = { enumerable: false }
function cloneNode(node: BaseSchema, out: any): any {
	if (out !== node) return out

	const target: any = { ...node, '~kind': (node as any)['~kind'] }
	for (const key of Object.getOwnPropertyNames(node)) {
		const desc = Object.getOwnPropertyDescriptor(node, key)
		if (!desc || desc.enumerable || key === '~kind') continue

		Object.defineProperty(target, key, {
			value: desc.value,
			enumerable: false,
			writable: true,
			configurable: true
		})
	}

	return Object.defineProperty(target, '~kind', noEnumerable)
}

function nonAdditionalPropertiesWalk(
	node: BaseSchema,
	seen: WeakSet<object>
): BaseSchema {
	if (!node || typeof node !== 'object' || seen.has(node)) return node
	seen.add(node)

	let out: any = node

	if (node.properties) {
		let newProps: Record<string, BaseSchema> | undefined
		for (const k in node.properties) {
			const v = node.properties[k] as BaseSchema
			const r = nonAdditionalPropertiesWalk(v, seen)
			if (r !== v) {
				newProps ??= { ...node.properties }
				newProps[k] = r
			}
		}
		if (newProps) {
			out = cloneNode(node, out)
			out.properties = newProps
		}
	}

	if (node.items) {
		if (Array.isArray(node.items)) {
			let newItems: BaseSchema[] | undefined
			for (let i = 0; i < node.items.length; i++) {
				const r = nonAdditionalPropertiesWalk(
					node.items[i] as BaseSchema,
					seen
				)
				if (r !== node.items[i]) {
					newItems ??= [...(node.items as BaseSchema[])]
					newItems[i] = r
				}
			}
			if (newItems) {
				out = cloneNode(node, out)
				out.items = newItems
			}
		} else {
			const r = nonAdditionalPropertiesWalk(
				node.items as BaseSchema,
				seen
			)
			if (r !== node.items) {
				out = cloneNode(node, out)
				out.items = r
			}
		}
	}

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = (node as any)[key]
		if (!Array.isArray(arr)) continue
		let newArr: BaseSchema[] | undefined
		for (let i = 0; i < arr.length; i++) {
			const r = nonAdditionalPropertiesWalk(arr[i], seen)
			if (r !== arr[i]) {
				newArr ??= [...arr]
				newArr[i] = r
			}
		}
		if (newArr) {
			out = cloneNode(node, out)
			out[key] = newArr
		}
	}

	if (
		node.additionalProperties &&
		typeof node.additionalProperties === 'object'
	) {
		const r = nonAdditionalPropertiesWalk(
			node.additionalProperties as BaseSchema,
			seen
		)
		if (r !== node.additionalProperties) {
			out = cloneNode(node, out)
			out.additionalProperties = r
		}
	}

	if (node.patternProperties) {
		let newPP: Record<string, BaseSchema> | undefined
		for (const k in node.patternProperties) {
			const v = node.patternProperties[k] as BaseSchema
			const r = nonAdditionalPropertiesWalk(v, seen)
			if (r !== v) {
				newPP ??= { ...node.patternProperties }
				newPP[k] = r
			}
		}
		if (newPP) {
			out = cloneNode(node, out)
			out.patternProperties = newPP
		}
	}

	// Apply the strict marker last so the recursion above doesn't
	// trip over `additionalProperties: false` (boolean, not schema).
	if (
		(node.type === 'object' || (node as any)['~kind'] === 'Object') &&
		!('additionalProperties' in node)
	) {
		out = cloneNode(node, out)
		out.additionalProperties = false
	}

	return out
}

export function nonAdditionalProperties(
	schema: BaseSchema | TSchema
): BaseSchema {
	return nonAdditionalPropertiesWalk(schema as BaseSchema, new WeakSet())
}

export function deferCoercions() {
	// @ts-expect-error
	_coerceRoot = undefined
	// @ts-expect-error
	_coerceQuery = undefined
	// @ts-expect-error
	_coerceFormData = undefined
	// @ts-expect-error
	_coerceStringToStructure = undefined
	// @ts-expect-error
	_coerceBody = undefined
}
