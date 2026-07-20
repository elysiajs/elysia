interface CompactError {
	keyword: string
	schemaPath: string
	instancePath: string
	params: Record<string, unknown>
	message: string
}

export type CompactErrorLocator = (value: unknown) => CompactError[]

type LocatorNode =
	| { node: 0; kind: string; diagnosable: false }
	| { node: 1; kind: string; diagnosable: boolean; type: string }
	| {
			node: 2
			kind: string
			diagnosable: boolean
			required?: string[]
			properties: Array<[string, LocatorNode]>
	  }
	| { node: 3; kind: string; diagnosable: boolean; item: LocatorNode }

const unknownLocator: LocatorNode = {
	node: 0,
	kind: 'schema',
	diagnosable: false
}

function findLocatedError(
	node: LocatorNode,
	value: unknown,
	instancePath: string,
	schemaPath: string
): CompactError | undefined {
	switch (node.node) {
		case 0:
			return
		case 1:
			return jsTypeMatches(value, node.type)
				? undefined
				: typeError({ type: node.type }, instancePath, schemaPath)
		case 2:
			if (!jsTypeMatches(value, 'object'))
				return typeError({ type: 'object' }, instancePath, schemaPath)
			if (node.required)
				for (const key of node.required)
					if (!(key in (value as object)))
						return {
							keyword: 'required',
							schemaPath,
							instancePath,
							params: { requiredProperties: [key] },
							message: `must have required properties ${key}`
						}
			for (const [key, child] of node.properties) {
				if (!(key in (value as object))) continue
				const hit = findLocatedError(
					child,
					(value as any)[key],
					`${instancePath}/${key}`,
					`${schemaPath}/properties/${key}`
				)
				if (hit) return hit
			}
			return
		case 3:
			if (!Array.isArray(value))
				return typeError({ type: 'array' }, instancePath, schemaPath)
			for (let index = 0; index < value.length; index++) {
				const hit = findLocatedError(
					node.item,
					value[index],
					`${instancePath}/${index}`,
					`${schemaPath}/items`
				)
				if (hit) return hit
			}
	}
}

const createLocatorRunner =
	(root: LocatorNode): CompactErrorLocator =>
	(value) => {
		const hit = findLocatedError(root, value, '', '#')
		return [
			hit ?? {
				keyword: 'type',
				schemaPath: '#',
				instancePath: '',
				params: {},
				message: `must match ${root.kind}`
			}
		]
	}

/**
 * Compiles the field locator needed by production-safe validation errors.
 * The returned closure retains only primitive type names, property names and
 * nested executable steps; it does not retain a schema-shaped object graph.
 */
export function createCompactErrorLocator(schema: any): CompactErrorLocator {
	const cache = new WeakMap<object, LocatorNode>()

	const build = (source: any): LocatorNode => {
		if (!source || typeof source !== 'object') return unknownLocator

		const cached = cache.get(source)
		if (cached) return cached

		const slot: LocatorNode = {
			node: 0,
			kind: source['~kind'] ?? 'schema',
			diagnosable: false
		}
		cache.set(source, slot)
		const type = source.type
		let node: LocatorNode = slot
		if (type === 'object') {
			const properties: Array<[string, LocatorNode]> = []
			if (source.properties)
				for (const key of Object.getOwnPropertyNames(source.properties))
					properties.push([key, build(source.properties[key])])
			node = {
				node: 2,
				kind: slot.kind,
				diagnosable: properties.every(([, child]) => child.diagnosable),
				required: Array.isArray(source.required)
					? source.required.slice()
					: undefined,
				properties
			}
		} else if (type === 'array') {
			const item = build(source.items)
			node = {
				node: 3,
				kind: slot.kind,
				diagnosable: item.diagnosable,
				item
			}
		} else if (typeof type === 'string') {
			node = {
				node: 1,
				kind: slot.kind,
				type,
				diagnosable:
					type === 'string' ||
					type === 'number' ||
					type === 'integer' ||
					type === 'boolean' ||
					type === 'null'
			}
		}

		Object.assign(slot, node)
		return slot
	}

	return createLocatorRunner(build(schema))
}

export function compactDiagnosticSchema(
	schema: any,
	seen = new WeakMap<object, any>()
): unknown {
	if (!schema || typeof schema !== 'object') return
	const cached = seen.get(schema)
	if (cached) return cached

	const out: any = {
		type: schema.type,
		'~kind': schema['~kind']
	}
	seen.set(schema, out)

	if (Array.isArray(schema.required)) out.required = schema.required.slice()
	if (schema.properties) {
		out.properties = Object.create(null)
		for (const key in schema.properties)
			out.properties[key] = compactDiagnosticSchema(
				schema.properties[key],
				seen
			)
	}
	if (schema.items)
		out.items = Array.isArray(schema.items)
			? schema.items.map((item: unknown) =>
					compactDiagnosticSchema(item, seen)
				)
			: compactDiagnosticSchema(schema.items, seen)
	if (schema.anyOf) out.anyOf = true
	if (schema.oneOf) out.oneOf = true
	if (schema.allOf) out.allOf = true

	return out
}

function jsTypeMatches(value: unknown, type: string) {
	switch (type) {
		case 'string':
			return typeof value === 'string'
		case 'number':
			return typeof value === 'number'
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value)
		case 'boolean':
			return typeof value === 'boolean'
		case 'null':
			return value === null
		case 'array':
			return Array.isArray(value)
		case 'object':
			return (
				typeof value === 'object' &&
				value !== null &&
				!Array.isArray(value)
			)
		default:
			return true
	}
}

const typeError = (
	schema: any,
	instancePath: string,
	schemaPath: string
): CompactError => ({
	keyword: 'type',
	schemaPath,
	instancePath,
	params: { type: schema.type },
	message: `must be ${schema.type}`
})

function walkCompactError(
	schema: any,
	value: unknown,
	instancePath: string,
	schemaPath: string
): CompactError | undefined {
	if (!schema || typeof schema !== 'object') return

	const type = schema.type
	if (type === 'object') {
		if (!jsTypeMatches(value, type))
			return typeError(schema, instancePath, schemaPath)

		const required: string[] | undefined = schema.required
		if (Array.isArray(required))
			for (const key of required)
				if (!(key in (value as object)))
					return {
						keyword: 'required',
						schemaPath,
						instancePath,
						params: { requiredProperties: [key] },
						message: `must have required properties ${key}`
					}

		const properties = schema.properties
		if (properties)
			for (const key in properties) {
				if (!(key in (value as object))) continue
				const child = walkCompactError(
					properties[key],
					(value as any)[key],
					`${instancePath}/${key}`,
					`${schemaPath}/properties/${key}`
				)
				if (child) return child
			}

		return
	}

	if (type === 'array') {
		if (!Array.isArray(value))
			return typeError(schema, instancePath, schemaPath)

		if (schema.items)
			for (let i = 0; i < value.length; i++) {
				const child = walkCompactError(
					schema.items,
					value[i],
					`${instancePath}/${i}`,
					`${schemaPath}/items`
				)
				if (child) return child
			}

		return
	}

	if (typeof type === 'string' && !jsTypeMatches(value, type))
		return typeError(schema, instancePath, schemaPath)
}

function bestEffortError(schema: any, value: unknown): CompactError {
	if (
		schema?.type === 'object' &&
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		schema.properties
	)
		for (const key in schema.properties) {
			if (!(key in (value as object))) continue
			if (isCompactDiagnosable(schema.properties[key])) continue

			return {
				keyword: 'type',
				schemaPath: `#/properties/${key}`,
				instancePath: `/${key}`,
				params: {},
				message: `must match ${schema.properties[key]?.['~kind'] ?? 'schema'}`
			}
		}

	return {
		keyword: 'type',
		schemaPath: '#',
		instancePath: '',
		params: {},
		message: `must match ${schema?.['~kind'] ?? 'schema'}`
	}
}

export function isCompactDiagnosable(schema: any): boolean {
	if (!schema || typeof schema !== 'object') return false
	if (schema.anyOf || schema.oneOf || schema.allOf) return false

	const type = schema.type
	if (type === 'object') {
		if (schema.properties)
			for (const key in schema.properties)
				if (!isCompactDiagnosable(schema.properties[key])) return false
		return true
	}
	if (type === 'array') return isCompactDiagnosable(schema.items)

	return (
		type === 'string' ||
		type === 'number' ||
		type === 'integer' ||
		type === 'boolean' ||
		type === 'null'
	)
}

export const compactErrors = (
	schema: unknown,
	value: unknown
): CompactError[] => {
	const hit = walkCompactError(schema, value, '', '#')
	return [hit ?? bestEffortError(schema, value)]
}
