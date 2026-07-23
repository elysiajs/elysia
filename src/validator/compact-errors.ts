import { Guard } from 'typebox/guard'

import { ELYSIA_BUILTIN, ELYSIA_TYPES } from '../type/constants'

interface CompactError {
	keyword: string
	schemaPath: string
	instancePath: string
	params: Record<string, unknown>
	message: string
}

const compactCoercionTypes = new Set<number>([
	ELYSIA_TYPES.Numeric,
	ELYSIA_TYPES.Integer,
	ELYSIA_TYPES.BooleanString,
	ELYSIA_TYPES.ObjectString,
	ELYSIA_TYPES.ArrayString
])

export const snapshotDiagnosticValue = (
	value: unknown,
	seen = new WeakMap<object, unknown>()
): unknown => {
	if (value === null || typeof value !== 'object') return value
	if ('~kind' in value || '~elyTyp' in value) return
	const cached = seen.get(value)
	if (cached !== undefined) return cached
	if (value instanceof Date) return new Date(value)
	if (value instanceof RegExp) return new RegExp(value)

	const out: any = Array.isArray(value)
		? []
		: Object.create(Object.getPrototypeOf(value))
	seen.set(value, out)
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (!descriptor || !('value' in descriptor)) continue
		Object.defineProperty(out, key, {
			...descriptor,
			value: snapshotDiagnosticValue(descriptor.value, seen)
		})
	}

	return out
}

const acceptsDate = (value: unknown) => {
	if (value instanceof Date) return !Number.isNaN(value.getTime())
	if (typeof value === 'number') return Number.isFinite(value)
	if (typeof value !== 'string') return false
	if (!Number.isNaN(new Date(value).getTime())) return true
	return (
		/T\d{2}:\d{2}(?::\d{2})? \d{2}:\d{2}$/.test(value) &&
		!Number.isNaN(
			new Date(value.replace(/ (\d{2}:\d{2})$/, '+$1')).getTime()
		)
	)
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

	const builtin = schema[ELYSIA_BUILTIN]
	if (
		builtin &&
		builtin.type === schema['~elyTyp'] &&
		compactCoercionTypes.has(builtin.type)
	) {
		out['~coerceCheck'] = builtin.check
		out['~coerceRootFallback'] = true
	} else if (
		schema['~elyTyp'] === ELYSIA_TYPES.Date &&
		schema['~kind'] === 'Union'
	)
		out['~builtinDiagnostic'] = 'Date'

	if (schema.error !== undefined)
		out.error = snapshotDiagnosticValue(schema.error)
	if (schema.default !== undefined)
		out.default = snapshotDiagnosticValue(schema.default)
	if (schema.const !== undefined)
		out.const = snapshotDiagnosticValue(schema.const)
	if (Array.isArray(schema.enum))
		out.enum = schema.enum.map(snapshotDiagnosticValue)
	for (const key of [
		'pattern',
		'minLength',
		'maxLength',
		'minimum',
		'maximum',
		'exclusiveMinimum',
		'exclusiveMaximum',
		'multipleOf',
		'minItems',
		'maxItems',
		'minProperties',
		'maxProperties'
	] as const)
		if (schema[key] !== undefined) out[key] = schema[key]
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
	for (const key of ['anyOf', 'oneOf', 'allOf'] as const)
		if (Array.isArray(schema[key]))
			out[key] = schema[key].map((item: unknown) =>
				compactDiagnosticSchema(item, seen)
			)
	if (
		compactCoercionTypes.has(schema['~elyTyp']) &&
		out.anyOf?.some((item: any) => item?.['~coerceRootFallback'])
	)
		out['~coerceRootFallback'] = true

	return out
}

function jsTypeMatches(value: unknown, type: string) {
	switch (type) {
		case 'string':
			return typeof value === 'string'
		case 'number':
			return Guard.IsNumber(value)
		case 'integer':
			return Guard.IsInteger(value)
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

const limitError = (
	keyword: string,
	limit: number,
	message: string,
	instancePath: string,
	schemaPath: string
): CompactError => ({
	keyword,
	schemaPath,
	instancePath,
	params: { limit },
	message
})

function walkCompactError(
	schema: any,
	value: unknown,
	instancePath: string,
	schemaPath: string
): CompactError | undefined {
	if (!schema || typeof schema !== 'object') return
	if (schema['~builtinDiagnostic'] === 'Date')
		return acceptsDate(value)
			? undefined
			: {
					keyword: 'type',
					schemaPath,
					instancePath,
					params: {},
					message: 'must be Date'
				}
	if (
		typeof schema['~coerceCheck'] === 'function' &&
		Array.isArray(schema.anyOf) &&
		schema.anyOf[0]
	) {
		if (schema['~coerceRootFallback']) return
		const first = walkCompactError(
			schema.anyOf[0],
			value,
			instancePath,
			schemaPath
		)
		if (!first || (typeof value === 'string' && schema['~coerceCheck'](value)))
			return
		return first
	}

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
		const size = Object.keys(value as object).length
		if (typeof schema.minProperties === 'number' && size < schema.minProperties)
			return limitError(
				'minProperties',
				schema.minProperties,
				`must not have fewer than ${schema.minProperties} properties`,
				instancePath,
				schemaPath
			)
		if (typeof schema.maxProperties === 'number' && size > schema.maxProperties)
			return limitError(
				'maxProperties',
				schema.maxProperties,
				`must not have more than ${schema.maxProperties} properties`,
				instancePath,
				schemaPath
			)

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

		if (typeof schema.minItems === 'number' && value.length < schema.minItems)
			return limitError(
				'minItems',
				schema.minItems,
				`must not have fewer than ${schema.minItems} items`,
				instancePath,
				schemaPath
			)
		if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
			return limitError(
				'maxItems',
				schema.maxItems,
				`must not have more than ${schema.maxItems} items`,
				instancePath,
				schemaPath
			)

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

	if (typeof type === 'string') {
		if (!jsTypeMatches(value, type))
			return typeError(schema, instancePath, schemaPath)
		if (type === 'number' || type === 'integer') {
			for (const [keyword, comparison, invalid] of [
				['minimum', '>=', (input: number, limit: number) => input < limit],
				['maximum', '<=', (input: number, limit: number) => input > limit],
				[
					'exclusiveMinimum',
					'>',
					(input: number, limit: number) => input <= limit
				],
				[
					'exclusiveMaximum',
					'<',
					(input: number, limit: number) => input >= limit
				]
			] as const) {
				const limit = schema[keyword]
				if (typeof limit === 'number' && invalid(value as number, limit))
					return {
						keyword,
						schemaPath,
						instancePath,
						params: { comparison, limit },
						message: `must be ${comparison} ${limit}`
					}
			}
			if (
				typeof schema.multipleOf === 'number' &&
				!Guard.IsMultipleOf(value as number, schema.multipleOf)
			)
				return {
					keyword: 'multipleOf',
					schemaPath,
					instancePath,
					params: { multipleOf: schema.multipleOf },
					message: `must be multiple of ${schema.multipleOf}`
				}
		}
		if (
			type === 'string' &&
			typeof schema.minLength === 'number' &&
			!Guard.IsMinLength(value as string, schema.minLength)
		)
			return limitError(
				'minLength',
				schema.minLength,
				`must not have fewer than ${schema.minLength} characters`,
				instancePath,
				schemaPath
			)
		if (
			type === 'string' &&
			typeof schema.maxLength === 'number' &&
			!Guard.IsMaxLength(value as string, schema.maxLength)
		)
			return limitError(
				'maxLength',
				schema.maxLength,
				`must not have more than ${schema.maxLength} characters`,
				instancePath,
				schemaPath
			)
		if (
			type === 'string' &&
			typeof schema.pattern === 'string' &&
			!new RegExp(schema.pattern).test(value as string)
		)
			return {
				keyword: 'pattern',
				schemaPath,
				instancePath,
				params: { pattern: schema.pattern },
				message: `must match pattern "${schema.pattern}"`
			}
	}
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
			const child = schema.properties[key]
			const childValue = (value as any)[key]
			if (
				typeof child?.['~coerceCheck'] === 'function' &&
				typeof childValue === 'string' &&
				child['~coerceCheck'](childValue)
			)
				continue
			if (isCompactDiagnosable(child)) continue
			if (child?.['~coerceRootFallback']) break

			return {
				keyword: 'type',
				schemaPath: `#/properties/${key}`,
				instancePath: `/${key}`,
				params: {},
				message: `must match ${child?.['~kind'] ?? 'schema'}`
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
