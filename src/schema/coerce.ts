import { TSchema } from 'typebox'
import { primitiveElysiaTypes, t, type BaseSchema } from '../type'

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
}

type CoerceTo = (schema: BaseSchema) => BaseSchema | null

/**
 * Replace schema types with custom transformation
 */
export function coerce(
	schema: BaseSchema | TSchema,
	fromTo: [from: string, to: CoerceTo][],
	options?: CoerceOptions
): BaseSchema {
	let transformMap = new Map<string, CoerceTo>(fromTo)
	let rootOption = options?.root
	let seen = new WeakSet()
	let stopped = false

	// Inline copy-on-write helper to avoid closure allocation
	// `~kind` is non-enumerable in TypeBox, so we reassign it after spread
	// https://sinclairzx81.github.io/typebox/#/docs/system/1_settings
	function copyNode(node: BaseSchema | TSchema) {
		return Object.defineProperty(
			// @ts-expect-error
			{ ...node, '~kind': node['~kind'] },
			'~kind',
			{
				enumerable: false
			}
		)
	}

	function walk(node: BaseSchema, isRoot: boolean): BaseSchema {
		if (
			!node ||
			stopped ||
			seen.has(node) ||
			typeof node !== 'object' ||
			(node['~elyTyp'] &&
				primitiveElysiaTypes.has(node['~elyTyp'] as any))
		)
			return node

		seen.add(node)

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

		if (canReplace && kind) {
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

					return result!
				}
			}
		}

		if (stopped) return node

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
				out = copyNode(node)
				out[key] = newArr
			}
		}

		// Not
		if (node.not) {
			const r = walk(node.not, false)
			if (r !== node.not && out === node) {
				out = copyNode(node)
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

				if (newItems && out === node) {
					out = copyNode(node)
					out.items = newItems
				}
			} else {
				const r = walk(items, false)
				if (r !== items && out === node) {
					out = copyNode(node)
					out.items = r
				}
			}
		}

		if (node.properties) {
			let newProps: Record<string, BaseSchema> | undefined
			const props = node.properties
			for (const k in props) {
				const v = props[k]!
				const r = walk(v, false)
				if (r !== v) {
					newProps ??= { ...props }
					newProps[k] = r
				}
			}

			if (newProps && out === node) {
				out = copyNode(node)
				out.properties = newProps
			}
		}

		if (typeof node.additionalProperties === 'object') {
			const r = walk(node.additionalProperties, false)
			if (r !== node.additionalProperties && out === node) {
				out = copyNode(node)
				out.additionalProperties = r
			}
		}

		// Record (patternProperties) - use for...in instead of Object.entries()
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

			if (newPP && out === node) {
				out = copyNode(node)
				out.patternProperties = newPP
			}
		}

		if (kind === 'Cyclic') {
			const def = node.$defs![
				node.$ref as keyof typeof node.$defs
			] as unknown as BaseSchema | undefined

			if (def) {
				const r = walk(def, false)
				if (r !== def && out === node) {
					out = copyNode(node)
					out.$defs = { ...node.$defs, [node.$ref!]: r }
				}
			}
		}

		return out
	}

	const q = walk(schema as any, true)

	transformMap.clear()
	// @ts-expect-error
	transformMap = undefined
	rootOption = undefined
	// @ts-expect-error
	seen = undefined
	// @ts-expect-error
	stopped = undefined

	return q
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
				['Number', (x) => t.Numeric(x as any)],
				['Boolean', (x) => t.BooleanString(x as any)]
			],
			{
				onlyFirst: 'object'
			}
		]
	])

let _coerceQuery: CoerceOption[]
export const coerceQuery = () =>
	(_coerceQuery ??= [
		[
			[
				['Object', (x) => t.ObjectString(x.properties ?? {}, x as any)],
				[
					'Array',
					(x) => t.ArrayString((x.items as any) ?? t.Any(), x as any)
				]
			],
			{
				root: false
			}
		]
	])

let _coerceFormData: CoerceOption[]
export const coerceFormData = () =>
	(_coerceFormData ??= [
		[
			[['Object', (x) => t.ObjectString(x.properties ?? {}, x as any)]],
			{
				root: false,
				onlyFirst: 'object'
			}
		],
		[
			[
				[
					'Array',
					(x) => t.ArrayString((x.items as any) ?? t.Any(), x as any)
				]
			],
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
			[['Object', (x) => t.ObjectString(x.properties ?? {}, x as any)]],
			{
				untilNonRootObjectFound: true
			}
		],
		[
			[
				[
					'Array',
					(x) => t.ArrayString((x.items as any) ?? t.Any(), x as any)
				]
			]
		]
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
