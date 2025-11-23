/* eslint-disable sonarjs/no-duplicate-string */
import {
	Kind,
	OptionalKind,
	TModule,
	TObject,
	TransformKind,
	TSchema,
	type TAnySchema
} from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { TypeCompiler } from '@sinclair/typebox/compiler'

import {
	createMirror,
	type Instruction as ExactMirrorInstruction
} from 'exact-mirror'

import { t, type TypeCheck } from './type-system'

import { deepClone, mergeCookie, mergeDeep, randomId } from './utils'
import { mapValueError } from './error'

import type { CookieOptions } from './cookies'
import type {
	ElysiaConfig,
	InputSchema,
	MaybeArray,
	StandaloneInputSchema,
	StandardSchemaV1LikeValidate
} from './types'

import type { StandardSchemaV1Like } from './types'

type MapValueError = ReturnType<typeof mapValueError>

export interface ElysiaTypeCheck<T extends TSchema>
	extends Omit<TypeCheck<T>, 'schema'> {
	provider: 'typebox' | 'standard'
	schema: T
	config: Object
	Clean?(v: unknown): T
	parse(v: unknown): T
	safeParse(v: unknown):
		| { success: true; data: T; error: null }
		| {
				success: false
				data: null
				error: string | undefined
				errors: MapValueError[]
		  }
	hasAdditionalProperties: boolean
	'~hasAdditionalProperties'?: boolean
	hasDefault: boolean
	'~hasDefault'?: boolean
	isOptional: boolean
	'~isOptional'?: boolean
	hasTransform: boolean
	'~hasTransform'?: boolean
	hasRef: boolean
	'~hasRef'?: boolean
}

export const isOptional = (
	schema?: TSchema | TypeCheck<any> | ElysiaTypeCheck<any>
) => {
	if (!schema) return false

	// @ts-ignore
	if (schema?.[Kind] === 'Import' && schema.References)
		return schema.References().some(isOptional as any)

	// @ts-expect-error private property
	if (schema.schema)
		// @ts-expect-error private property
		schema = schema.schema

	return !!schema && OptionalKind in schema
}

export const hasAdditionalProperties = (
	_schema: TAnySchema | TypeCheck<any> | ElysiaTypeCheck<any>
): boolean => {
	if (!_schema) return false

	// @ts-expect-error private property
	const schema: TAnySchema = (_schema as TypeCheck<any>)?.schema ?? _schema

	if (schema[Kind] === 'Import' && _schema.References)
		return _schema.References().some(hasAdditionalProperties)

	if (schema.anyOf) return schema.anyOf.some(hasAdditionalProperties)
	if (schema.someOf) return schema.someOf.some(hasAdditionalProperties)
	if (schema.allOf) return schema.allOf.some(hasAdditionalProperties)
	if (schema.not) return schema.not.some(hasAdditionalProperties)

	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>

		if ('additionalProperties' in schema) return schema.additionalProperties
		if ('patternProperties' in schema) return false

		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (property.type === 'object') {
				if (hasAdditionalProperties(property)) return true
			} else if (property.anyOf) {
				for (let i = 0; i < property.anyOf.length; i++)
					if (hasAdditionalProperties(property.anyOf[i])) return true
			}

			return property.additionalProperties
		}

		return false
	}

	if (schema.type === 'array' && schema.items && !Array.isArray(schema.items))
		return hasAdditionalProperties(schema.items)

	return false
}

export const hasType = (type: string, schema: TAnySchema) => {
	if (!schema) return false

	if (Kind in schema && schema[Kind] === type) return true

	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>
		if (!properties) return false

		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (property.type === 'object') {
				if (hasType(type, property)) return true
			} else if (property.anyOf) {
				for (let i = 0; i < property.anyOf.length; i++)
					if (hasType(type, property.anyOf[i])) return true
			}

			if (Kind in property && property[Kind] === type) return true
		}

		return false
	}

	return (
		!!schema.properties &&
		Kind in schema.properties &&
		schema.properties[Kind] === type
	)
}

export const hasElysiaMeta = (meta: string, _schema: TAnySchema): boolean => {
	if (!_schema) return false

	// @ts-expect-error private property
	const schema: TAnySchema = (_schema as TypeCheck<any>)?.schema ?? _schema

	if (schema.elysiaMeta === meta) return true

	if (schema[Kind] === 'Import' && _schema.References)
		return _schema
			.References()
			.some((schema: TSchema) => hasElysiaMeta(meta, schema))

	if (schema.anyOf)
		return schema.anyOf.some((schema: TSchema) =>
			hasElysiaMeta(meta, schema)
		)
	if (schema.someOf)
		return schema.someOf.some((schema: TSchema) =>
			hasElysiaMeta(meta, schema)
		)
	if (schema.allOf)
		return schema.allOf.some((schema: TSchema) =>
			hasElysiaMeta(meta, schema)
		)
	if (schema.not)
		return schema.not.some((schema: TSchema) => hasElysiaMeta(meta, schema))

	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>

		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (property.type === 'object') {
				if (hasElysiaMeta(meta, property)) return true
			} else if (property.anyOf) {
				for (let i = 0; i < property.anyOf.length; i++)
					if (hasElysiaMeta(meta, property.anyOf[i])) return true
			}

			return schema.elysiaMeta === meta
		}

		return false
	}

	if (schema.type === 'array' && schema.items && !Array.isArray(schema.items))
		return hasElysiaMeta(meta, schema.items)

	return false
}

export const hasProperty = (
	expectedProperty: string,
	_schema: TAnySchema | TypeCheck<any> | ElysiaTypeCheck<any>
) => {
	if (!_schema) return

	// @ts-expect-error private property
	const schema = _schema.schema ?? _schema

	if (schema[Kind] === 'Import' && _schema.References)
		return _schema
			.References()
			.some((schema: TAnySchema) => hasProperty(expectedProperty, schema))

	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>

		if (!properties) return false

		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (expectedProperty in property) return true

			if (property.type === 'object') {
				if (hasProperty(expectedProperty, property)) return true
			} else if (property.anyOf)
				for (let i = 0; i < property.anyOf.length; i++)
					if (hasProperty(expectedProperty, property.anyOf[i]))
						return true
		}

		return false
	}

	return expectedProperty in schema
}

export const hasRef = (schema: TAnySchema): boolean => {
	if (!schema) return false

	if (schema.oneOf)
		for (let i = 0; i < schema.oneOf.length; i++)
			if (hasRef(schema.oneOf[i])) return true

	if (schema.anyOf)
		for (let i = 0; i < schema.anyOf.length; i++)
			if (hasRef(schema.anyOf[i])) return true

	if (schema.oneOf)
		for (let i = 0; i < schema.oneOf.length; i++)
			if (hasRef(schema.oneOf[i])) return true

	if (schema.allOf)
		for (let i = 0; i < schema.allOf.length; i++)
			if (hasRef(schema.allOf[i])) return true

	if (schema.not && hasRef(schema.not)) return true

	if (schema.type === 'object' && schema.properties) {
		const properties = schema.properties as Record<string, TAnySchema>

		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (hasRef(property)) return true

			if (
				property.type === 'array' &&
				property.items &&
				hasRef(property.items)
			)
				return true
		}
	}

	if (schema.type === 'array' && schema.items && hasRef(schema.items))
		return true

	return schema[Kind] === 'Ref' && '$ref' in schema
}

export const hasTransform = (schema: TAnySchema): boolean => {
	if (!schema) return false

	if (
		schema.$ref &&
		schema.$defs &&
		schema.$ref in schema.$defs &&
		hasTransform(schema.$defs[schema.$ref])
	)
		return true

	if (schema.oneOf)
		for (let i = 0; i < schema.oneOf.length; i++)
			if (hasTransform(schema.oneOf[i])) return true

	if (schema.anyOf)
		for (let i = 0; i < schema.anyOf.length; i++)
			if (hasTransform(schema.anyOf[i])) return true

	if (schema.allOf)
		for (let i = 0; i < schema.allOf.length; i++)
			if (hasTransform(schema.allOf[i])) return true

	if (schema.not && hasTransform(schema.not)) return true

	if (schema.type === 'object' && schema.properties) {
		const properties = schema.properties as Record<string, TAnySchema>

		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (hasTransform(property)) return true

			if (
				property.type === 'array' &&
				property.items &&
				hasTransform(property.items)
			)
				return true
		}
	}

	if (schema.type === 'array' && schema.items && hasTransform(schema.items))
		return true

	return TransformKind in schema
}

interface ReplaceSchemaTypeOptions {
	from: TSchema
	to(options: Object): TSchema | null
	excludeRoot?: boolean
	rootOnly?: boolean
	original?: TAnySchema
	/**
	 * Traverse until object is found except root object
	 **/
	untilObjectFound?: boolean
	/**
	 * Only replace first object type
	 **/
	onlyFirst?: 'object' | 'array' | (string & {})
}

interface ReplaceSchemaTypeConfig {
	root: boolean
	definitions?: Record<string, TSchema> | undefined
}

export const replaceSchemaType = (
	schema: TSchema,
	options: MaybeArray<ReplaceSchemaTypeOptions>,
	_config: Partial<Omit<ReplaceSchemaTypeConfig, 'root'>> = {}
) => {
	const config = _config as ReplaceSchemaTypeConfig
	config.root = true

	// if (schema.$defs)
	// 	config.definitions = {
	// 		...config.definitions,
	// 		...schema.$defs
	// 	}

	// const corceDefinitions = (option: ReplaceSchemaTypeOptions) => {
	// 	if (!config.definitions) return

	// 	for (const [key, value] of Object.entries(config.definitions)) {
	// 		const fromSymbol = option.from[Kind]

	// 		if (fromSymbol === 'Ref') continue

	// 		config.definitions[key] = _replaceSchemaType(value, option, config)
	// 	}
	// }

	if (!Array.isArray(options)) {
		options.original = schema

		// corceDefinitions(options)

		return _replaceSchemaType(schema, options, config)
	}

	for (const option of options) {
		option.original = schema

		// corceDefinitions(option)

		schema = _replaceSchemaType(schema, option, config)
	}

	return schema
}

const _replaceSchemaType = (
	schema: TSchema,
	options: ReplaceSchemaTypeOptions,
	config: ReplaceSchemaTypeConfig
): TSchema => {
	if (!schema) return schema

	const root = config.root

	if (options.onlyFirst && schema.type === options.onlyFirst)
		return options.to(schema) ?? schema

	if (options.untilObjectFound && !root && schema.type === 'object')
		return schema

	const fromSymbol = options.from[Kind]

	// if (schema.$ref) {
	// 	if (schema.$defs && schema.$ref in schema.$defs) {
	// 		const definitions: Record<string, TSchema> = {}

	// 		for (const [key, value] of Object.entries(schema.$defs))
	// 			definitions[key] = _replaceSchemaType(
	// 				value as TSchema,
	// 				options,
	// 				config
	// 			)

	// 		config.definitions = { ...config.definitions, ...definitions }
	// 	}

	// 	return schema
	// }

	if (schema.oneOf) {
		for (let i = 0; i < schema.oneOf.length; i++)
			schema.oneOf[i] = _replaceSchemaType(
				schema.oneOf[i],
				options,
				config
			)

		return schema
	}

	if (schema.anyOf) {
		for (let i = 0; i < schema.anyOf.length; i++)
			schema.anyOf[i] = _replaceSchemaType(
				schema.anyOf[i],
				options,
				config
			)

		return schema
	}

	if (schema.allOf) {
		for (let i = 0; i < schema.allOf.length; i++)
			schema.allOf[i] = _replaceSchemaType(
				schema.allOf[i],
				options,
				config
			)

		return schema
	}

	if (schema.not) return _replaceSchemaType(schema.not, options, config)

	const isRoot = root && !!options.excludeRoot

	if (schema[Kind] === fromSymbol) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { anyOf, oneOf, allOf, not, properties, items, ...rest } = schema

		const to = options.to(rest)

		if (!to) return schema

		// If t.Transform is used, we need to re-calculate Encode, Decode
		let transform

		const composeProperties = (schema: TSchema) => {
			const v = _composeProperties(schema)

			// $id is removed because it's used in Union inside an Import
			if (v.$id) delete v.$id

			return v
		}

		const _composeProperties = (v: TSchema) => {
			if (properties && v.type === 'object') {
				const newProperties = <Record<string, unknown>>{}
				for (const [key, value] of Object.entries(properties))
					newProperties[key] = _replaceSchemaType(
						value as TSchema,
						options,
						{
							...config,
							root: false
						}
					)

				return {
					...rest,
					...v,
					properties: newProperties
				}
			}

			if (items && v.type === 'array')
				return {
					...rest,
					...v,
					items: _replaceSchemaType(items, options, {
						...config,
						root: false
					})
				}

			const value = {
				...rest,
				...v
			}

			// Remove required as it's not object
			delete value['required']

			// Create default value for ObjectString
			if (
				properties &&
				v.type === 'string' &&
				v.format === 'ObjectString' &&
				v.default === '{}'
			) {
				transform = t.ObjectString(properties, rest)
				value.properties = properties
			}
			// Create default value for ArrayString
			else if (
				items &&
				v.type === 'string' &&
				v.format === 'ArrayString' &&
				v.default === '[]'
			) {
				transform = t.ArrayString(items, rest)
				value.items = items
			}

			return value
		}

		if (isRoot) {
			if (properties) {
				const newProperties = <Record<string, unknown>>{}
				for (const [key, value] of Object.entries(properties))
					newProperties[key] = _replaceSchemaType(
						value as TSchema,
						options,
						{
							...config,
							root: false
						}
					)

				return {
					...rest,
					properties: newProperties
				}
			} else if (items?.map)
				return {
					...rest,
					items: items.map((v: TSchema) =>
						_replaceSchemaType(v, options, {
							...config,
							root: false
						})
					)
				}

			return rest
		}

		if (to.anyOf)
			for (let i = 0; i < to.anyOf.length; i++)
				to.anyOf[i] = composeProperties(to.anyOf[i])
		else if (to.oneOf)
			for (let i = 0; i < to.oneOf.length; i++)
				to.oneOf[i] = composeProperties(to.oneOf[i])
		else if (to.allOf)
			for (let i = 0; i < to.allOf.length; i++)
				to.allOf[i] = composeProperties(to.allOf[i])
		else if (to.not) to.not = composeProperties(to.not)

		if (transform) to[TransformKind as any] = transform[TransformKind]

		if (to.anyOf || to.oneOf || to.allOf || to.not) return to

		if (properties) {
			const newProperties = <Record<string, unknown>>{}
			for (const [key, value] of Object.entries(properties))
				newProperties[key] = _replaceSchemaType(
					value as TSchema,
					options,
					{
						...config,
						root: false
					}
				)

			return {
				...rest,
				...to,
				properties: newProperties
			}
		} else if (items?.map)
			return {
				...rest,
				...to,
				items: items.map((v: TSchema) =>
					_replaceSchemaType(v, options, {
						...config,
						root: false
					})
				)
			}

		return {
			...rest,
			...to
		}
	}

	const properties = schema?.properties as Record<string, TSchema>

	if (properties && root && options.rootOnly !== true)
		for (const [key, value] of Object.entries(properties)) {
			switch (value[Kind]) {
				case fromSymbol:
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					const { anyOf, oneOf, allOf, not, type, ...rest } = value
					const to = options.to(rest)

					if (!to) return schema

					if (to.anyOf)
						for (let i = 0; i < to.anyOf.length; i++)
							to.anyOf[i] = { ...rest, ...to.anyOf[i] }
					else if (to.oneOf)
						for (let i = 0; i < to.oneOf.length; i++)
							to.oneOf[i] = { ...rest, ...to.oneOf[i] }
					else if (to.allOf)
						for (let i = 0; i < to.allOf.length; i++)
							to.allOf[i] = { ...rest, ...to.allOf[i] }
					else if (to.not) to.not = { ...rest, ...to.not }

					properties[key] = {
						...rest,
						..._replaceSchemaType(rest, options, {
							...config,
							root: false
						})
					}
					break

				case 'Object':
				case 'Union':
					properties[key] = _replaceSchemaType(value, options, {
						...config,
						root: false
					})
					break

				default:
					if (Array.isArray(value.items)) {
						for (let i = 0; i < value.items.length; i++) {
							value.items[i] = _replaceSchemaType(
								value.items[i],
								options,
								{
									...config,
									root: false
								}
							)
						}
					} else if (
						value.anyOf ||
						value.oneOf ||
						value.allOf ||
						value.not
					)
						properties[key] = _replaceSchemaType(value, options, {
							...config,
							root: false
						})
					else if (value.type === 'array') {
						value.items = _replaceSchemaType(value.items, options, {
							...config,
							root: false
						})
					}

					break
			}
		}

	if (schema.type === 'array' && schema.items)
		if (Array.isArray(schema.items))
			schema.items = schema.items.map((item) =>
				_replaceSchemaType(item, options, {
					...config,
					root: false
				})
			)
		else
			schema.items = _replaceSchemaType(schema.items, options, {
				...config,
				root: false
			})

	return schema
}

/**
 * Recursively checks if a schema contains union types (anyOf, oneOf, allOf)
 * This is used to determine if exact-mirror can handle the schema properly
 */
const hasUnionType = (schema: TAnySchema): boolean => {
	if (!schema) return false

	// Check for union/intersection types
	if (schema.anyOf || schema.oneOf || schema.allOf) return true

	// Check array items
	if (schema.type === 'array' && schema.items && !Array.isArray(schema.items))
		return hasUnionType(schema.items)

	// Check object properties
	if (schema.type === 'object' && schema.properties) {
		for (const prop of Object.values(
			schema.properties as Record<string, TAnySchema>
		)) {
			if (hasUnionType(prop)) return true
		}
	}

	return false
}

const createCleaner = (
	schema: TAnySchema,
	sanitizeFn?: ExactMirrorInstruction['sanitize']
) => {
	const isPlainObject = (value: unknown): value is Record<string, unknown> =>
		typeof value === 'object' && value !== null && !Array.isArray(value)

	const clean = (currentSchema: TAnySchema, value: unknown): unknown => {
		if (typeof value !== 'object' || value === null) return value

		// Manually handle unions so we can try cleaning against each branch.
		// Value.Clean bails out early when the union doesn't initially pass
		// validation (eg. additionalProperties: false), which prevents
		// normalization for cases like t.Omit(t.Union(...)).
		if (currentSchema.anyOf) {
			for (const branch of currentSchema.anyOf) {
				const cleaned = clean(branch, deepClone(value))

				try {
					if (Value.Check(branch, cleaned)) return cleaned
				} catch {}
			}

			// Fallback to TypeBox behaviour if nothing matched
			try {
				return Value.Clean(currentSchema, value)
			} catch {}

			return value
		}

		if (currentSchema.oneOf) {
			for (const branch of currentSchema.oneOf) {
				const cleaned = clean(branch, deepClone(value))

				try {
					if (Value.Check(branch, cleaned)) return cleaned
				} catch {}
			}

			try {
				return Value.Clean(currentSchema, value)
			} catch {}

			return value
		}

		if (currentSchema.allOf) {
			const cleaned = currentSchema.allOf.map((branch: TAnySchema) =>
				clean(branch, deepClone(value))
			)

			const mergedObjects = cleaned.filter(isPlainObject) as (
				| Record<string, unknown>
				| undefined
			)[]

			if (mergedObjects.length)
				return mergedObjects.reduce(
					(acc, current) => ({ ...acc, ...current }),
					{}
				)

			return cleaned.at(-1) ?? value
		}

		// Handle arrays - recursively clean each item
		if (
			Array.isArray(value) &&
			currentSchema.type === 'array' &&
			currentSchema.items &&
			!Array.isArray(currentSchema.items)
		) {
			return value.map((item) =>
				clean(currentSchema.items as TAnySchema, item)
			)
		}

		// For all other cases including unions, use TypeBox's Value.Clean
		// It handles unions, intersections, and objects correctly
		try {
			let cleaned = Value.Clean(currentSchema, value)

			// Apply sanitize function if provided
			if (sanitizeFn && isPlainObject(cleaned)) {
				cleaned = applySanitize(currentSchema, cleaned, sanitizeFn)
			}

			return cleaned
		} catch {}

		return value
	}

	const applySanitize = (
		currentSchema: TAnySchema,
		value: any,
		sanitizeFn: ExactMirrorInstruction['sanitize']
	): any => {
		if (!isPlainObject(value)) return value

		const result: any = {}

		if (currentSchema.type === 'object' && currentSchema.properties) {
			const sanitizeProperty = (
				propSchema: TAnySchema,
				propValue: any,
				key: string
			): any => {
				// Resolve $ref using root schema or its definitions if present
				if (propSchema?.$ref) {
					if (schema?.$defs && propSchema.$ref in schema.$defs)
						return sanitizeProperty(
							(schema.$defs as Record<string, TAnySchema>)[
								propSchema.$ref
							],
							propValue,
							key
						)

					return sanitizeProperty(
						schema as TAnySchema,
						propValue,
						key
					)
				}

				if (propSchema.anyOf) {
					for (const branch of propSchema.anyOf) {
						// null branch
						if (branch.type === 'null') {
							if (propValue === null) return propValue
							continue
						}

						// array branch
						if (
							branch.type === 'array' &&
							Array.isArray(propValue) &&
							branch.items &&
							!Array.isArray(branch.items)
						)
							return propValue.map((item: any) =>
								sanitizeProperty(
									branch.items as TAnySchema,
									item,
									key
								)
							)

						// object branch
						if (
							branch.type === 'object' &&
							isPlainObject(propValue)
						)
							return applySanitize(branch, propValue, sanitizeFn)

						// reference branch (recursive)
						if (branch.$ref) {
							if (isPlainObject(propValue))
								return applySanitize(
									(
										schema.$defs as
											| Record<string, TAnySchema>
											| undefined
									)?.[branch.$ref] ?? (schema as TAnySchema),
									propValue,
									sanitizeFn
								)
							continue
						}

						// nested union
						if (branch.anyOf) {
							const result = sanitizeProperty(
								branch as TAnySchema,
								propValue,
								key
							)

							if (result !== propValue) return result
						}
					}

					// Fallback if no branch matched
					return propValue
				}

				if (propSchema.type === 'object' && isPlainObject(propValue))
					return applySanitize(propSchema, propValue, sanitizeFn)

				if (
					propSchema.type === 'array' &&
					Array.isArray(propValue) &&
					propSchema.items &&
					!Array.isArray(propSchema.items)
				)
					return propValue.map((item: any) =>
						sanitizeProperty(
							propSchema.items as TAnySchema,
							item,
							key
						)
					)

				// Only apply sanitize to string values
				if (!sanitizeFn || typeof propValue !== 'string')
					return propValue

				if (Array.isArray(sanitizeFn)) {
					let result = propValue
					for (const fn of sanitizeFn) {
						result = fn(result)
					}
					return result
				}

				return sanitizeFn(propValue)
			}

			for (const [key, propSchema] of Object.entries(
				currentSchema.properties as Record<string, TAnySchema>
			)) {
				if (!(key in value)) continue

				result[key] = sanitizeProperty(propSchema, value[key], key)
			}
		} else {
			// If no properties defined, copy all properties and apply sanitize
			for (const [key, propValue] of Object.entries(value)) {
				// Only apply sanitize to string values
				if (!sanitizeFn || typeof propValue !== 'string') {
					result[key] = propValue
				} else if (Array.isArray(sanitizeFn)) {
					let sanitized = propValue
					for (const fn of sanitizeFn) {
						sanitized = fn(sanitized)
					}
					result[key] = sanitized
				} else {
					result[key] = sanitizeFn(propValue)
				}
			}
		}

		return result
	}

	return (value: unknown) => clean(schema, value)
}

// const caches = <Record<string, ElysiaTypeCheck<any>>>{}

export const getSchemaValidator = <
	T extends TSchema | StandardSchemaV1Like | string | undefined
>(
	s: T,
	{
		models = {},
		dynamic = false,
		modules,
		normalize = false,
		additionalProperties = false,
		forceAdditionalProperties = false,
		coerce = false,
		additionalCoerce = [],
		validators,
		sanitize
	}: {
		models?: Record<string, TSchema | StandardSchemaV1Like>
		modules?: TModule<any, any>
		additionalProperties?: boolean
		forceAdditionalProperties?: boolean
		dynamic?: boolean
		normalize?: ElysiaConfig<''>['normalize']
		coerce?: boolean
		additionalCoerce?: MaybeArray<ReplaceSchemaTypeOptions>
		validators?: InputSchema['body'][]
		sanitize?: () => ExactMirrorInstruction['sanitize']
	} = {}
): T extends TSchema ? ElysiaTypeCheck<T> : undefined => {
	validators = validators?.filter((x) => x)

	if (!s) {
		if (!validators?.length) return undefined as any

		s = validators[0] as any
		validators = validators.slice(1)
	}

	let doesHaveRef: boolean | undefined = undefined

	const replaceSchema = (schema: TAnySchema): TAnySchema => {
		if (coerce)
			return replaceSchemaType(schema, [
				{
					from: t.Number(),
					to: (options) => t.Numeric(options),
					untilObjectFound: true
				},
				{
					from: t.Boolean(),
					to: (options) => t.BooleanString(options),
					untilObjectFound: true
				},
				...(Array.isArray(additionalCoerce)
					? additionalCoerce
					: [additionalCoerce])
			])

		return replaceSchemaType(schema, additionalCoerce)
	}

	const mapSchema = (
		s: string | TSchema | StandardSchemaV1Like | undefined
	): TSchema | StandardSchemaV1Like => {
		if (s && typeof s !== 'string' && '~standard' in s)
			return s as StandardSchemaV1Like

		if (!s) return undefined as any

		let schema: TSchema | StandardSchemaV1Like

		if (typeof s !== 'string') schema = s
		else {
			schema =
				// @ts-expect-error private property
				modules && s in modules.$defs
					? (modules as TModule<{}, {}>).Import(s as never)
					: models[s]

			if (!schema) return undefined as any
		}

		if (Kind in schema) {
			if (schema[Kind] === 'Import') {
				if (!hasRef(schema.$defs[schema.$ref])) {
					schema = schema.$defs[schema.$ref]

					if (coerce || additionalCoerce)
						schema = replaceSchema(schema as TSchema)
				}
			} else {
				if (hasRef(schema)) {
					const id = randomId()

					const model: any = t.Module({
						// @ts-expect-error private property
						...modules?.$defs,
						[id]: schema
					})

					schema = model.Import(id)
				} else if (coerce || additionalCoerce)
					schema = replaceSchema(schema as TSchema)
			}
		}

		return schema
	}

	let schema = mapSchema(s)
	let _validators = validators

	if (
		'~standard' in schema ||
		(validators?.length &&
			validators.some(
				(x) => x && typeof x !== 'string' && '~standard' in x
			))
	) {
		const typeboxSubValidator = (
			schema: TSchema
		): StandardSchemaV1LikeValidate => {
			let mirror: Function | undefined
			if (normalize === true || normalize === 'exactMirror') {
				// Use TypeBox's Value.Clean for schemas with unions as exact-mirror doesn't handle them properly
				if (hasUnionType(schema)) {
					mirror = createCleaner(schema, sanitize?.())
				} else {
					try {
						mirror = createMirror(schema, {
							TypeCompiler,
							sanitize: sanitize?.(),
							modules
						})
					} catch {
						console.warn(
							'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
						)
						console.warn(schema)
						mirror = createCleaner(schema, sanitize?.())
					}
				}
			}

			const vali = getSchemaValidator(schema, {
				models,
				modules,
				dynamic,
				normalize,
				additionalProperties: true,
				forceAdditionalProperties: true,
				coerce,
				additionalCoerce,
				sanitize
			})!

			// @ts-ignore
			if (mirror) vali.Decode = mirror

			// @ts-ignore
			return (v) => {
				if (vali.Check(v)) {
					return {
						value: vali.Decode(v)
					}
				} else
					return {
						issues: [...vali.Errors(v)]
					}
			}
		}

		const mainCheck = schema['~standard']
			? schema['~standard'].validate
			: typeboxSubValidator(schema as TSchema)

		let checkers = <StandardSchemaV1LikeValidate[]>[]
		if (validators?.length)
			for (const validator of validators) {
				if (!validator) continue
				if (typeof validator === 'string') continue

				if (validator?.['~standard']) {
					checkers.push(validator['~standard'])
					continue
				}

				if (Kind in validator) {
					checkers.push(typeboxSubValidator(validator))
					continue
				}
			}

		async function Check(value: unknown) {
			let v = mainCheck(value)
			if (v instanceof Promise) v = await v
			if (v.issues) return v

			const values = <(Record<string, unknown> | unknown[])[]>[]

			if (v && typeof v === 'object') values.push(v.value as any)

			for (let i = 0; i < checkers.length; i++) {
				// @ts-ignore
				v = checkers[i].validate(value)
				if (v instanceof Promise) v = await v
				if (v.issues) return v

				// @ts-ignore
				if (v && typeof v === 'object') values.push(v.value)
			}

			if (!values.length) return { value: v }
			if (values.length === 1) return { value: values[0] }
			if (values.length === 2)
				return { value: mergeDeep(values[0], values[1]) }

			let newValue = mergeDeep(values[0], values[1])

			for (let i = 2; i < values.length; i++)
				newValue = mergeDeep(newValue, values[i])

			return { value: newValue }
		}

		const validator: ElysiaTypeCheck<any> = {
			provider: 'standard',
			schema,
			references: '',
			checkFunc: () => {},
			code: '',
			// @ts-ignore
			Check,
			// @ts-ignore
			Errors: (value: unknown) => Check(value)?.then?.((x) => x?.issues),
			Code: () => '',
			// @ts-ignore
			Decode: Check,
			// @ts-ignore
			Encode: (value: unknown) => value,
			hasAdditionalProperties: false,
			hasDefault: false,
			isOptional: false,
			hasTransform: false,
			hasRef: false
		}

		validator.parse = (v) => {
			try {
				return validator.Decode(validator.Clean?.(v) ?? v)
			} catch (error) {
				throw [...validator.Errors(v)].map(mapValueError)
			}
		}

		validator.safeParse = (v) => {
			try {
				return {
					success: true,
					data: validator.Decode(validator.Clean?.(v) ?? v),
					error: null
				}
			} catch (error) {
				const errors = [...compiled.Errors(v)].map(mapValueError)

				return {
					success: false,
					data: null,
					error: errors[0]?.summary,
					errors
				}
			}
		}

		return validator as any
	} else if (validators?.length) {
		let hasAdditional = false

		const validators = _validators as TSchema[]

		const { schema: mergedObjectSchema, notObjects } = mergeObjectSchemas([
			schema,
			...(validators.map(mapSchema) as TSchema[])
		])

		if (notObjects) {
			schema = t.Intersect([
				...(mergedObjectSchema ? [mergedObjectSchema] : []),
				...notObjects.map((x) => {
					const schema = mapSchema(x) as TSchema

					if (
						schema.type === 'object' &&
						'additionalProperties' in schema
					) {
						if (
							!hasAdditional &&
							schema.additionalProperties === false
						) {
							hasAdditional = true
						}

						delete schema.additionalProperties
					}

					return schema
				})
			])

			if (schema.type === 'object' && hasAdditional)
				schema.additionalProperties = false
		}
	} else {
		if (
			schema.type === 'object' &&
			('additionalProperties' in schema === false ||
				forceAdditionalProperties)
		)
			schema.additionalProperties = additionalProperties
		else
			schema = replaceSchemaType(schema, {
				onlyFirst: 'object',
				from: t.Object({}),
				// @ts-ignore
				to({ properties, ...options }) {
					// If nothing is return, use the original schema
					if (!properties) return
					if ('additionalProperties' in schema) return

					return t.Object(properties, {
						...options,
						additionalProperties: false
					})
				}
			})
	}

	if (dynamic) {
		if (Kind in schema) {
			const validator: ElysiaTypeCheck<any> = {
				provider: 'typebox',
				schema,
				references: '',
				checkFunc: () => {},
				code: '',
				// @ts-expect-error
				Check: (value: unknown) => Value.Check(schema, value),
				Errors: (value: unknown) => Value.Errors(schema, value),
				Code: () => '',
				Clean: createCleaner(schema, sanitize?.()),
				Decode: (value: unknown) => Value.Decode(schema, value),
				Encode: (value: unknown) => Value.Encode(schema, value),
				get hasAdditionalProperties() {
					if ('~hasAdditionalProperties' in this)
						return this['~hasAdditionalProperties'] as boolean

					return (this['~hasAdditionalProperties'] =
						hasAdditionalProperties(schema))
				},
				get hasDefault() {
					if ('~hasDefault' in this) return this['~hasDefault']

					return (this['~hasDefault'] = hasProperty(
						'default',
						schema
					))
				},
				get isOptional() {
					if ('~isOptional' in this) return this['~isOptional']!

					return (this['~isOptional'] = isOptional(schema))
				},
				get hasTransform() {
					if ('~hasTransform' in this) return this['~hasTransform']!

					return (this['~hasTransform'] = hasTransform(schema))
				},
				'~hasRef': doesHaveRef,
				get hasRef() {
					if ('~hasRef' in this) return this['~hasRef']!

					return (this['~hasRef'] = hasTransform(schema))
				}
			}

			if (schema.config) {
				validator.config = schema.config

				if (validator?.schema?.config) delete validator.schema.config
			}

			if (normalize && !hasAdditionalProperties(schema)) {
				if (normalize === true || normalize === 'exactMirror') {
					// Use TypeBox's Value.Clean for schemas with unions as exact-mirror doesn't handle them properly
					if (hasUnionType(schema)) {
						validator.Clean = createCleaner(schema, sanitize?.())
					} else {
						try {
							validator.Clean = createMirror(schema, {
								TypeCompiler,
								sanitize: sanitize?.(),
								modules
							})
						} catch {
							console.warn(
								'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
							)
							console.warn(schema)
							validator.Clean = createCleaner(
								schema,
								sanitize?.()
							)
						}
					}
				} else validator.Clean = createCleaner(schema, sanitize?.())
			}

			validator.parse = (v) => {
				try {
					return validator.Decode(validator.Clean?.(v) ?? v)
				} catch (error) {
					throw [...validator.Errors(v)].map(mapValueError)
				}
			}

			validator.safeParse = (v) => {
				try {
					return {
						success: true,
						data: validator.Decode(validator.Clean?.(v) ?? v),
						error: null
					}
				} catch (error) {
					const errors = [...compiled.Errors(v)].map(mapValueError)

					return {
						success: false,
						data: null,
						error: errors[0]?.summary,
						errors
					}
				}
			}

			// if (cacheKey) caches[cacheKey] = validator

			return validator as any
		} else {
			const validator: ElysiaTypeCheck<any> = {
				provider: 'standard',
				schema,
				references: '',
				checkFunc: () => {},
				code: '',
				// @ts-ignore
				Check: (v) => schema['~standard'].validate(v),
				// @ts-ignore
				Errors(value: unknown) {
					// @ts-ignore
					const response = schema['~standard'].validate(value)

					if (response instanceof Promise)
						throw Error(
							'Async validation is not supported in non-dynamic schema'
						)

					return response.issues
				},
				Code: () => '',
				// @ts-ignore
				Decode(value) {
					// @ts-ignore
					const response = schema['~standard'].validate(value)

					if (response instanceof Promise)
						throw Error(
							'Async validation is not supported in non-dynamic schema'
						)

					return response
				},
				// @ts-ignore
				Encode: (value: unknown) => value,
				hasAdditionalProperties: false,
				hasDefault: false,
				isOptional: false,
				hasTransform: false,
				hasRef: false
			}

			validator.parse = (v) => {
				try {
					return validator.Decode(validator.Clean?.(v) ?? v)
				} catch (error) {
					throw [...validator.Errors(v)].map(mapValueError)
				}
			}

			validator.safeParse = (v) => {
				try {
					return {
						success: true,
						data: validator.Decode(validator.Clean?.(v) ?? v),
						error: null
					}
				} catch (error) {
					const errors = [...compiled.Errors(v)].map(mapValueError)

					return {
						success: false,
						data: null,
						error: errors[0]?.summary,
						errors
					}
				}
			}

			// if (cacheKey) caches[cacheKey] = validator

			return validator as any
		}
	}

	let compiled: ElysiaTypeCheck<any>

	if (Kind in schema) {
		compiled = TypeCompiler.Compile(
			schema,
			Object.values(models).filter((x) => Kind in x)
		) as any
		compiled.provider = 'typebox'

		if (schema.config) {
			compiled.config = schema.config

			if (compiled?.schema?.config) delete compiled.schema.config
		}

		if (normalize === true || normalize === 'exactMirror') {
			// Use TypeBox's Value.Clean for schemas with unions as exact-mirror doesn't handle them properly
			if (hasUnionType(schema)) {
				compiled.Clean = createCleaner(schema, sanitize?.())
			} else {
				try {
					compiled.Clean = createMirror(schema, {
						TypeCompiler,
						sanitize: sanitize?.(),
						modules
					})
				} catch (error) {
					console.warn(
						'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
					)
					console.dir(schema, {
						depth: null
					})

					compiled.Clean = createCleaner(schema, sanitize?.())
				}
			}
		} else if (normalize === 'typebox')
			compiled.Clean = createCleaner(schema, sanitize?.())
	} else {
		compiled = {
			provider: 'standard',
			schema,
			references: '',
			checkFunc(value: unknown) {
				// @ts-ignore
				const response = schema['~standard'].validate(value)

				if (response instanceof Promise)
					throw Error(
						'Async validation is not supported in non-dynamic schema'
					)

				return response
			},
			code: '',
			// @ts-ignore
			Check: (v) => schema['~standard'].validate(v),
			// @ts-ignore
			Errors(value: unknown) {
				// @ts-ignore
				const response = schema['~standard'].validate(value)

				if (response instanceof Promise)
					throw Error(
						'Async validation is not supported in non-dynamic schema'
					)

				return response.issues
			},
			Code: () => '',
			// @ts-ignore
			Decode(value) {
				// @ts-ignore
				const response = schema['~standard'].validate(value)

				if (response instanceof Promise)
					throw Error(
						'Async validation is not supported in non-dynamic schema'
					)

				return response
			},
			// @ts-ignore
			Encode: (value: unknown) => value,
			hasAdditionalProperties: false,
			hasDefault: false,
			isOptional: false,
			hasTransform: false,
			hasRef: false
		}
	}

	compiled.parse = (v) => {
		try {
			return compiled.Decode(compiled.Clean?.(v) ?? v)
		} catch (error) {
			throw [...compiled.Errors(v)].map(mapValueError)
		}
	}

	compiled.safeParse = (v) => {
		try {
			return {
				success: true,
				data: compiled.Decode(compiled.Clean?.(v) ?? v),
				error: null
			}
		} catch (error) {
			const errors = [...compiled.Errors(v)].map(mapValueError)

			return {
				success: false,
				data: null,
				error: errors[0]?.summary,
				errors
			}
		}
	}

	if (Kind in schema)
		Object.assign(compiled, {
			get hasAdditionalProperties() {
				if ('~hasAdditionalProperties' in this)
					return this['~hasAdditionalProperties']

				return (this['~hasAdditionalProperties'] =
					hasAdditionalProperties(compiled))
			},
			get hasDefault() {
				if ('~hasDefault' in this) return this['~hasDefault']

				return (this['~hasDefault'] = hasProperty('default', compiled))
			},
			get isOptional() {
				if ('~isOptional' in this) return this['~isOptional']!

				return (this['~isOptional'] = isOptional(compiled))
			},
			get hasTransform() {
				if ('~hasTransform' in this) return this['~hasTransform']!

				return (this['~hasTransform'] = hasTransform(schema))
			},
			get hasRef() {
				if ('~hasRef' in this) return this['~hasRef']!

				return (this['~hasRef'] = hasRef(schema))
			},
			'~hasRef': doesHaveRef
		} as ElysiaTypeCheck<any>)

	// if (cacheKey) caches[cacheKey] = compiled

	return compiled as any
}

export const isUnion = (schema: TSchema) =>
	schema[Kind] === 'Union' || (!schema.schema && !!schema.anyOf)

export const mergeObjectSchemas = (
	schemas: TSchema[]
): {
	schema: TObject | undefined
	notObjects: TSchema[]
} => {
	if (schemas.length === 0) {
		return {
			schema: undefined,
			notObjects: []
		}
	}
	if (schemas.length === 1)
		return schemas[0].type === 'object'
			? {
					schema: schemas[0] as TObject,
					notObjects: []
				}
			: {
					schema: undefined,
					notObjects: schemas
				}

	let newSchema: TObject
	const notObjects = <TSchema[]>[]

	let additionalPropertiesIsTrue = false
	let additionalPropertiesIsFalse = false

	for (const schema of schemas) {
		if (schema.type !== 'object') {
			notObjects.push(schema)
			continue
		}

		if ('additionalProperties' in schema) {
			if (schema.additionalProperties === true)
				additionalPropertiesIsTrue = true
			else if (schema.additionalProperties === false)
				additionalPropertiesIsFalse = true
		}

		if (!newSchema!) {
			newSchema = schema as TObject
			continue
		}

		newSchema = {
			...newSchema,
			...schema,
			properties: {
				...newSchema.properties,
				...schema.properties
			},
			required: [
				...(newSchema?.required ?? []),
				...(schema.required ?? [])
			]
		} as TObject
	}

	if (newSchema!) {
		if (newSchema.required)
			newSchema.required = [...new Set(newSchema.required)]

		if (additionalPropertiesIsFalse) newSchema.additionalProperties = false
		else if (additionalPropertiesIsTrue)
			newSchema.additionalProperties = true
	}

	return {
		schema: newSchema!,
		notObjects
	}
}

export const getResponseSchemaValidator = (
	s: InputSchema['response'] | undefined,
	{
		models = {},
		modules,
		dynamic = false,
		normalize = false,
		additionalProperties = false,
		validators = [],
		sanitize
	}: {
		modules: TModule<any, any>
		models?: Record<string, TSchema | StandardSchemaV1Like>
		additionalProperties?: boolean
		dynamic?: boolean
		normalize?: ElysiaConfig<''>['normalize']
		validators?: StandaloneInputSchema['response'][]
		sanitize?: () => ExactMirrorInstruction['sanitize']
	}
): Record<number, ElysiaTypeCheck<any>> | undefined => {
	validators = validators.filter((x) => x)

	if (!s) {
		if (!validators?.length) return undefined as any

		s = validators[0] as any
		validators = validators.slice(1)
	}

	let maybeSchemaOrRecord:
		| TSchema
		| StandardSchemaV1Like
		| Record<number, string | TSchema | StandardSchemaV1Like>

	// @ts-ignore
	if (typeof s !== 'string') maybeSchemaOrRecord = s!
	else {
		maybeSchemaOrRecord = // @ts-expect-error private property
			modules && s in modules.$defs
				? (modules as TModule<{}, {}>).Import(s as never)
				: models[s]

		if (!maybeSchemaOrRecord) return undefined as any
	}

	if (!maybeSchemaOrRecord) return

	if (Kind in maybeSchemaOrRecord || '~standard' in maybeSchemaOrRecord)
		return {
			200: getSchemaValidator(
				maybeSchemaOrRecord as TSchema | StandardSchemaV1Like,
				{
					modules,
					models,
					additionalProperties,
					dynamic,
					normalize,
					coerce: false,
					additionalCoerce: [],
					validators: validators.map((x) => x![200]),
					sanitize
				}
			)!
		}

	const record: Record<number, ElysiaTypeCheck<any>> = {}

	Object.keys(maybeSchemaOrRecord).forEach((status): TSchema | undefined => {
		if (isNaN(+status)) return

		const maybeNameOrSchema = maybeSchemaOrRecord[+status]

		if (typeof maybeNameOrSchema === 'string') {
			if (maybeNameOrSchema in models) {
				const schema = models[maybeNameOrSchema]

				if (!schema) return

				// Inherits model maybe already compiled
				record[+status] =
					Kind in schema || '~standard' in schema
						? getSchemaValidator(schema as TSchema, {
								modules,
								models,
								additionalProperties,
								dynamic,
								normalize,
								coerce: false,
								additionalCoerce: [],
								validators: validators.map((x) => x![+status]),
								sanitize
							})!
						: (schema as ElysiaTypeCheck<any>)
			}

			return undefined
		}

		// Inherits model maybe already compiled
		record[+status] =
			Kind in maybeNameOrSchema || '~standard' in maybeNameOrSchema
				? getSchemaValidator(maybeNameOrSchema as TSchema, {
						modules,
						models,
						additionalProperties,
						dynamic,
						normalize,
						coerce: false,
						additionalCoerce: [],
						validators: validators.map((x) => x![+status]),
						sanitize
					})
				: (maybeNameOrSchema as ElysiaTypeCheck<any>)
	})

	return record
}

let _stringToStructureCoercions: ReplaceSchemaTypeOptions[]

export const stringToStructureCoercions = () => {
	if (!_stringToStructureCoercions) {
		_stringToStructureCoercions = [
			{
				from: t.Object({}),
				to: () => t.ObjectString({}),
				excludeRoot: true
			},
			{
				from: t.Array(t.Any()),
				to: () => t.ArrayString(t.Any())
			}
		] satisfies ReplaceSchemaTypeOptions[]
	}

	return _stringToStructureCoercions
}

let _queryCoercions: ReplaceSchemaTypeOptions[]

export const queryCoercions = () => {
	if (!_queryCoercions) {
		_queryCoercions = [
			{
				from: t.Object({}),
				to: () => t.ObjectString({}),
				excludeRoot: true
			},
			{
				from: t.Array(t.Any()),
				to: () => t.ArrayQuery(t.Any())
			}
		] satisfies ReplaceSchemaTypeOptions[]
	}

	return _queryCoercions
}

let _coercePrimitiveRoot: ReplaceSchemaTypeOptions[]

export const coercePrimitiveRoot = () => {
	if (!_coercePrimitiveRoot)
		_coercePrimitiveRoot = [
			{
				from: t.Number(),
				to: (options) => t.Numeric(options),
				rootOnly: true
			},
			{
				from: t.Boolean(),
				to: (options) => t.BooleanString(options),
				rootOnly: true
			}
		] satisfies ReplaceSchemaTypeOptions[]

	return _coercePrimitiveRoot
}

export const getCookieValidator = ({
	validator,
	modules,
	defaultConfig = {},
	config,
	dynamic,
	normalize = false,
	models,
	validators,
	sanitize
}: {
	validator:
		| TSchema
		| StandardSchemaV1Like
		| ElysiaTypeCheck<any>
		| string
		| undefined
	modules: TModule<any, any>
	defaultConfig: CookieOptions | undefined
	config: CookieOptions
	dynamic: boolean
	normalize: ElysiaConfig<''>['normalize'] | undefined
	models: Record<string, TSchema | StandardSchemaV1Like> | undefined
	validators?: InputSchema['cookie'][]
	sanitize?: () => ExactMirrorInstruction['sanitize']
}) => {
	let cookieValidator =
		// @ts-ignore
		validator?.provider
			? (validator as ElysiaTypeCheck<any>)
			: // @ts-ignore
				getSchemaValidator(validator, {
					modules,
					dynamic,
					models,
					normalize,
					additionalProperties: true,
					coerce: true,
					additionalCoerce: stringToStructureCoercions(),
					validators,
					sanitize
				})

	if (cookieValidator)
		cookieValidator.config = mergeCookie(cookieValidator.config, config)
	else {
		cookieValidator = getSchemaValidator(t.Cookie(t.Any()), {
			modules,
			dynamic,
			models,
			additionalProperties: true,
			validators,
			sanitize
		})

		cookieValidator.config = defaultConfig
	}

	return cookieValidator
}

/**
 * This function will return the type of unioned if all unioned type is the same.
 * It's intent to use for content-type mapping only
 *
 * ```ts
 * t.Union([
 *   t.Object({
 *     password: t.String()
 *   }),
 *   t.Object({
 *     token: t.String()
 *   })
 * ])
 * ```
 */
// const getUnionedType = (validator: TypeCheck<any> | undefined) => {
// 	if (!validator) return

// 	// @ts-ignore
// 	const schema = validator?.schema ?? validator

// 	if (schema && 'anyOf' in schema) {
// 		let foundDifference = false
// 		const type: string = schema.anyOf[0].type

// 		for (const validator of schema.anyOf as { type: string }[]) {
// 			if (validator.type !== type) {
// 				foundDifference = true
// 				break
// 			}
// 		}

// 		if (!foundDifference) return type
// 	}

// 	// @ts-ignore
// 	return validator.schema?.type
// }

export const unwrapImportSchema = (schema: TSchema): TSchema =>
	schema &&
	schema[Kind] === 'Import' &&
	schema.$defs[schema.$ref][Kind] === 'Object'
		? schema.$defs[schema.$ref]
		: schema
