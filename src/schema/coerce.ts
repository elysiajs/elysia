import type { BaseSchema } from '../type-system'

export interface CoercionOptions {
	/**
	 * Replace schema
	 *
	 * - `true`: Replace only schema on root level
	 * - `false`: Replace schema that is not on root level
	 * - `undefined`: Replace all schemas regardless of their level
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
	schema: BaseSchema,
	fromTo: [from: string, to: CoerceTo][],
	options?: CoercionOptions
): BaseSchema {
	const transformMap = new Map<string, CoerceTo>(fromTo)

	// Cache options to avoid repeated optional chaining
	const rootOption = options?.root

	const seen = new WeakSet()
	let stopped = false

	function walk(node: BaseSchema, isRoot: boolean): BaseSchema {
		if (!node || typeof node !== 'object' || stopped) return node
		if (seen.has(node)) return node
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
				const properties = Object.assign({}, node)
				delete properties['type']
				const result = to(properties)
				if (result !== null) {
					if (options?.onlyFirst === kind) stopped = true
					return result
				}
			}
		}

		if (stopped) return node

		let out: any = node

		// Inline copy-on-write helper to avoid closure allocation
		// `~kind` is non-enumerable in TypeBox, so we reassign it after spread
		const copyNode = () => {
			if (out === node) out = { ...node, '~kind': kind }
		}

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
				copyNode()
				out[key] = newArr
			}
		}

		// Not
		if (node.not) {
			const r = walk(node.not, false)
			if (r !== node.not) {
				copyNode()
				out.not = r
			}
		}

		// Items (array or tuple)
		const items = node.items
		if (items) {
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
					copyNode()
					out.items = newItems
				}
			} else {
				const r = walk(items, false)
				if (r !== items) {
					copyNode()
					out.items = r
				}
			}
		}

		// Object properties - use for...in instead of Object.entries()
		const props = node.properties
		if (props) {
			let newProps: Record<string, BaseSchema> | undefined
			for (const k in props) {
				const v = props[k]!
				const r = walk(v, false)
				if (r !== v) {
					newProps ??= { ...props }
					newProps[k] = r
				}
			}

			if (newProps) {
				copyNode()
				out.properties = newProps
			}
		}

		// additionalProperties
		const addProps = node.additionalProperties
		if (typeof addProps === 'object') {
			const r = walk(addProps, false)
			if (r !== addProps) {
				copyNode()
				out.additionalProperties = r
			}
		}

		// Record (patternProperties) - use for...in instead of Object.entries()
		const patternProps = node.patternProperties
		if (patternProps) {
			let newPP: Record<string, BaseSchema> | undefined
			for (const k in patternProps) {
				const v = patternProps[k]!
				const r = walk(v, false)
				if (r !== v) {
					newPP ??= { ...patternProps }
					newPP[k] = r
				}
			}

			if (newPP) {
				copyNode()
				out.patternProperties = newPP
			}
		}

		// Cyclic — unwrap only the referenced def
		const $ref = node.$ref
		const $defs = node.$defs
		if (kind === 'Cyclic' && $defs && $ref) {
			const def = $defs[$ref] as BaseSchema | undefined
			if (def) {
				const r = walk(def, false)
				if (r !== def) {
					copyNode()
					out.$defs = { ...$defs, [$ref]: r }
				}
			}
		}

		return out
	}

	return walk(schema, true)
}
