// ! This module must be typebox free
import { dangerousKeys } from '../../constants'

export function schemaSome(
	schema: any,
	test: (node: any) => boolean,
	seen: WeakSet<object> = new WeakSet(),
	// stop descending below a matching node (the node itself is still tested)
	prune?: (node: any) => boolean,
	// also descend if/then/else and inherited `properties` keys
	// (default-precompute walkers)
	conditional = false
) {
	if (!schema || typeof schema !== 'object' || seen.has(schema)) return false
	seen.add(schema)

	if (test(schema)) return true
	if (prune && prune(schema)) return false

	const props = schema.properties
	if (props)
		for (const k in props)
			if (
				(conditional || Object.hasOwn(props, k)) &&
				schemaSome(props[k], test, seen, prune, conditional)
			)
				return true

	const items = schema.items
	if (Array.isArray(items)) {
		for (const it of items)
			if (schemaSome(it, test, seen, prune, conditional)) return true
	} else if (items && schemaSome(items, test, seen, prune, conditional))
		return true

	for (const k of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = schema[k]
		if (Array.isArray(arr))
			for (const x of arr)
				if (schemaSome(x, test, seen, prune, conditional)) return true
	}

	if (
		schema.additionalProperties &&
		typeof schema.additionalProperties === 'object' &&
		schemaSome(schema.additionalProperties, test, seen, prune, conditional)
	)
		return true

	if (schema.not && schemaSome(schema.not, test, seen, prune, conditional))
		return true

	if (conditional)
		for (const k of ['if', 'then', 'else'] as const)
			if (schema[k] && schemaSome(schema[k], test, seen, prune, true))
				return true

	const pp = schema.patternProperties
	if (pp)
		for (const k in pp)
			if (schemaSome(pp[k], test, seen, prune, conditional)) return true

	return false
}

export const schemaHasDangerousProperties = (schema: any) =>
	schemaSome(schema, (node) => {
		const properties = node.properties
		if (!properties) return false

		for (const key of dangerousKeys)
			if (Object.hasOwn(properties, key)) return true

		return false
	})

export function isCleanSafeNode(
	node: any,
	visiting: WeakSet<object>,
	clean: WeakSet<object>
) {
	if (!node || typeof node !== 'object') return true
	if (clean.has(node)) return true
	if (visiting.has(node)) return false // cycle: bail (Ref/This/Cyclic territory)

	visiting.add(node)

	const safe = checkCleanSafeNode(node, visiting, clean)

	visiting.delete(node)
	if (safe) clean.add(node)

	return safe
}

function checkCleanSafeNode(
	node: any,
	visiting: WeakSet<object>,
	clean: WeakSet<object>
): boolean {
	// A codec/refine can rewrite the value → Clean is not redundant.
	if (node['~codec'] || node['~refine'] || node['~elyTyp'] !== undefined)
		return false

	const kind = node['~kind']
	if (
		kind === 'Union' ||
		kind === 'Intersect' ||
		kind === 'Ref' ||
		kind === 'This' ||
		kind === 'Cyclic' ||
		node.$ref !== undefined ||
		Array.isArray(node.anyOf) ||
		Array.isArray(node.allOf) ||
		Array.isArray(node.oneOf) ||
		node.not !== undefined ||
		node.if !== undefined ||
		node.patternProperties !== undefined
	)
		return false

	const isObject = kind === 'Object' || node.type === 'object'
	if (isObject) {
		// Must be closed: an open object lets excess keys pass Check.
		if (node.additionalProperties !== false) return false

		if (node.properties)
			for (const k in node.properties)
				if (
					Object.hasOwn(node.properties, k) &&
					!isCleanSafeNode(node.properties[k], visiting, clean)
				)
					return false

		return true
	}

	if (kind === 'Array' || node.type === 'array') {
		const items = node.items
		if (Array.isArray(items) || items === undefined) return false

		return isCleanSafeNode(items, visiting, clean)
	}

	// Any other leaf (String/Number/Boolean/Date/...)
	return true
}

export function isFullyClosedObject(schema: any) {
	if (!schema || typeof schema !== 'object') return false

	const kind = schema['~kind']
	if (kind !== 'Object' && schema.type !== 'object') return false

	return isCleanSafeNode(schema, new WeakSet(), new WeakSet())
}
