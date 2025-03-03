/* eslint-disable sonarjs/no-duplicate-string */
import {
	Kind,
	OptionalKind,
	TModule,
	TransformKind,
	TSchema,
	type TAnySchema
} from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { TypeCompiler } from '@sinclair/typebox/compiler'

import { createAccelerator } from 'json-accelerator'

import { t, type TypeCheck } from './type-system'

import { isNotEmpty, mergeCookie } from './utils'
import { mapValueError } from './error'

import type { CookieOptions } from './cookies'
import type { InputSchema, MaybeArray } from './types'

type MapValueError = ReturnType<typeof mapValueError>

export interface ElysiaTypeCheck<T extends TSchema>
	extends Omit<TypeCheck<T>, 'schema'> {
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
	sucrose: {
		hasAdditionalProperties: boolean
		'~hasAdditionalProperties'?: boolean
		hasDefault: boolean
		'~hasDefault'?: boolean
		isOptional: boolean
		'~isOptional'?: boolean
		hasTransform: boolean
		'~hasTransform'?: boolean
	}
}

export const isOptional = (
	schema?: TSchema | TypeCheck<any> | ElysiaTypeCheck<any>
) => {
	if (!schema) return false

	// @ts-expect-error private property
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
) => {
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

	return false
}

export const hasType = (type: string, schema: TAnySchema) => {
	if (!schema) return

	if (Kind in schema && schema[Kind] === type) return true

	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>
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
		schema.properties &&
		Kind in schema.properties &&
		schema.properties[Kind] === type
	)
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
			} else if (property.anyOf) {
				for (let i = 0; i < property.anyOf.length; i++) {
					if (hasProperty(expectedProperty, property.anyOf[i]))
						return true
				}
			}
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

	if (schema.anyOf) {
		for (let i = 0; i < schema.anyOf.length; i++)
			if (hasTransform(schema.anyOf[i])) return true
	}

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
}

export const replaceSchemaType = (
	schema: TSchema,
	options: MaybeArray<ReplaceSchemaTypeOptions>,
	root = true
) => {
	if (!Array.isArray(options)) {
		options.original = schema

		return _replaceSchemaType(schema, options, root)
	}

	for (const option of options) {
		option.original = schema

		schema = _replaceSchemaType(schema, option, root)
	}

	return schema
}

const _replaceSchemaType = (
	schema: TSchema,
	options: ReplaceSchemaTypeOptions,
	root = true
) => {
	if (!schema) return schema
	if (options.untilObjectFound && !root && schema.type === 'object')
		return schema

	const fromSymbol = options.from[Kind]

	if (schema.oneOf) {
		for (let i = 0; i < schema.oneOf.length; i++)
			schema.oneOf[i] = _replaceSchemaType(schema.oneOf[i], options, root)

		return schema
	}

	if (schema.anyOf) {
		for (let i = 0; i < schema.anyOf.length; i++)
			schema.anyOf[i] = _replaceSchemaType(schema.anyOf[i], options, root)

		return schema
	}

	if (schema.allOf) {
		for (let i = 0; i < schema.allOf.length; i++)
			schema.allOf[i] = _replaceSchemaType(schema.allOf[i], options, root)

		return schema
	}

	if (schema.not) return _replaceSchemaType(schema.not, options, root)

	const isRoot = root && !!options.excludeRoot

	if (schema[Kind] === fromSymbol) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { anyOf, oneOf, allOf, not, properties, items, ...rest } = schema
		const to = options.to(rest)

		if (!to) return schema

		// If t.Transform is used, we need to re-calculate Encode, Decode
		let transform

		const composeProperties = (v: TSchema) => {
			if (properties && v.type === 'object') {
				const newProperties = <Record<string, unknown>>{}
				for (const [key, value] of Object.entries(properties))
					newProperties[key] = _replaceSchemaType(
						value as TSchema,
						options,
						false
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
					items: _replaceSchemaType(items, options, false)
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
				value.default = JSON.stringify(
					Value.Create(t.Object(properties))
				)
				value.properties = properties
			}

			// Create default value for ArrayString
			if (
				items &&
				v.type === 'string' &&
				v.format === 'ArrayString' &&
				v.default === '[]'
			) {
				transform = t.ArrayString(items, rest)
				value.default = JSON.stringify(Value.Create(t.Array(items)))
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
						false
					)

				return {
					...rest,
					properties: newProperties
				}
			} else if (items?.map)
				return {
					...rest,
					items: items.map((v: TSchema) =>
						_replaceSchemaType(v, options, false)
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
					false
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
					_replaceSchemaType(v, options, false)
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
						..._replaceSchemaType(rest, options, false)
					}
					break

				case 'Object':
				case 'Union':
					properties[key] = _replaceSchemaType(value, options, false)
					break

				default:
					if (Array.isArray(value.items)) {
						for (let i = 0; i < value.items.length; i++) {
							value.items[i] = _replaceSchemaType(
								value.items[i],
								options,
								false
							)
						}
					} else if (
						value.anyOf ||
						value.oneOf ||
						value.allOf ||
						value.not
					)
						properties[key] = _replaceSchemaType(
							value,
							options,
							false
						)
					else if (value.type === 'array') {
						value.items = _replaceSchemaType(
							value.items,
							options,
							false
						)
					}

					break
			}
		}

	return schema
}

// const unwrapImport = (schema: TImport<any, any>) => {
// 	if (
// 		!schema ||
// 		!schema.$defs ||
// 		!schema.$ref ||
// 		!(schema.$ref in schema.$defs)
// 	)
// 		return schema

// 	return schema.$defs[schema.$ref]
// }

const createCleaner = (schema: TAnySchema) => (value: unknown) => {
	if (typeof value === 'object')
		try {
			return Value.Clean(schema, structuredClone(value))
		} catch {
			try {
				return Value.Clean(schema, value)
			} catch {
				return value
			}
		}

	return value
}

// const caches = <Record<string, ElysiaTypeCheck<any>>>{}

export const getSchemaValidator = <T extends TSchema | string | undefined>(
	s: T,
	{
		models = {},
		dynamic = false,
		modules,
		normalize = false,
		additionalProperties = false,
		coerce = false,
		additionalCoerce = []
	}: {
		models?: Record<string, TSchema>
		modules: TModule<any, any>
		additionalProperties?: boolean
		dynamic?: boolean
		normalize?: boolean
		coerce?: boolean
		additionalCoerce?: MaybeArray<ReplaceSchemaTypeOptions>
	} = {
		modules: t.Module({})
	}
): T extends TSchema ? ElysiaTypeCheck<TSchema> : undefined => {
	if (!s) return undefined as any

	let schema: TSchema
	let cacheKey: string | undefined

	if (typeof s !== 'string') schema = s
	else {
		// if (s in caches) return caches[s] as any

		cacheKey = s

		const isArray = s.endsWith('[]')
		const key = isArray ? s.substring(0, s.length - 2) : s

		schema =
			(modules as TModule<{}, {}>).Import(key as never) ?? models[key]

		if (isArray) schema = t.Array(schema)
	}

	if (!schema) return undefined as any

	if (coerce || additionalCoerce) {
		if (coerce)
			schema = replaceSchemaType(schema, [
				{
					from: t.Ref(''),
					// @ts-expect-error
					to: (options) => modules.Import(options['$ref'])
				},
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
		else {
			schema = replaceSchemaType(schema, [
				{
					from: t.Ref(''),
					// @ts-expect-error
					to: (options) => modules.Import(options['$ref'])
				},
				...(Array.isArray(additionalCoerce)
					? additionalCoerce
					: [additionalCoerce])
			])
		}
	}

	if (schema.type === 'object' && 'additionalProperties' in schema === false)
		schema.additionalProperties = additionalProperties

	if (dynamic) {
		const validator: ElysiaTypeCheck<any> = {
			schema,
			references: '',
			checkFunc: () => {},
			code: '',
			// @ts-expect-error
			Check: (value: unknown) => Value.Check(schema, value),
			Errors: (value: unknown) => Value.Errors(schema, value),
			Code: () => '',
			Clean: createCleaner(schema),
			Decode: (value: unknown) => Value.Decode(schema, value),
			Encode: (value: unknown) => Value.Encode(schema, value),
			sucrose: {
				get hasAdditionalProperties() {
					if ('~hasAdditionalProperties' in this)
						return this['~hasAdditionalProperties']

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
				}
			}
		}

		if (schema.config) {
			validator.config = schema.config

			if (validator?.schema?.config) delete validator.schema.config
		}

		if (normalize && schema.additionalProperties === false)
			validator.Clean = createCleaner(schema)

		validator.parse = (v) => {
			try {
				return validator.Decode(v)
			} catch (error) {
				throw [...validator.Errors(v)].map(mapValueError)
			}
		}

		validator.safeParse = (v) => {
			try {
				return { success: true, data: validator.Decode(v), error: null }
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

	const compiled = TypeCompiler.Compile(
		schema,
		Object.values(models)
	) as any as ElysiaTypeCheck<any>

	if (schema.config) {
		compiled.config = schema.config

		if (compiled?.schema?.config) delete compiled.schema.config
	}

	compiled.Clean = createCleaner(schema)

	compiled.parse = (v) => {
		try {
			return compiled.Decode(v)
		} catch (error) {
			throw [...compiled.Errors(v)].map(mapValueError)
		}
	}

	compiled.safeParse = (v) => {
		try {
			return { success: true, data: compiled.Decode(v), error: null }
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

	compiled.sucrose = {
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
		}
	}

	// if (cacheKey) caches[cacheKey] = compiled

	return compiled as any
}

export const getResponseSchemaValidator = (
	s: InputSchema['response'] | undefined,
	{
		models = {},
		modules,
		dynamic = false,
		normalize = false,
		additionalProperties = false
	}: {
		modules: TModule<any, any>
		models?: Record<string, TSchema>
		additionalProperties?: boolean
		dynamic?: boolean
		normalize?: boolean
	}
): Record<number, ElysiaTypeCheck<any>> | undefined => {
	if (!s) return

	let maybeSchemaOrRecord: TSchema | Record<number, string | TSchema>

	if (typeof s !== 'string') maybeSchemaOrRecord = s
	else {
		const isArray = s.endsWith('[]')
		const key = isArray ? s.substring(0, s.length - 2) : s

		maybeSchemaOrRecord =
			(modules as TModule<{}, {}>).Import(key as never) ?? models[key]

		if (isArray)
			maybeSchemaOrRecord = t.Array(maybeSchemaOrRecord as TSchema)
	}

	if (!maybeSchemaOrRecord) return

	// const compile = (schema: TSchema, references?: TSchema[]) => {
	// 	if (dynamic)
	// 		return {
	// 			schema,
	// 			references: '',
	// 			checkFunc: () => {},
	// 			code: '',
	// 			Check: (value: unknown) => Value.Check(schema, value),
	// 			Errors: (value: unknown) => Value.Errors(schema, value),
	// 			Code: () => '',
	// 			Clean: createCleaner(schema),
	// 			Decode: (value: unknown) => Value.Decode(schema, value),
	// 			Encode: (value: unknown) => Value.Encode(schema, value)
	// 		} as unknown as TypeCheck<TSchema>

	// 	const compiledValidator = TypeCompiler.Compile(schema, references)

	// 	if (normalize && schema.additionalProperties === false)
	// 		// @ts-ignore
	// 		compiledValidator.Clean = createCleaner(schema)

	// 	return compiledValidator
	// }

	if (Kind in maybeSchemaOrRecord) {
		if ('additionalProperties' in maybeSchemaOrRecord === false)
			maybeSchemaOrRecord.additionalProperties = additionalProperties

		return {
			200: getSchemaValidator(maybeSchemaOrRecord, {
				modules,
				models,
				additionalProperties,
				dynamic,
				normalize,
				coerce: false,
				additionalCoerce: []
			})
		}
	}

	const record: Record<number, ElysiaTypeCheck<any>> = {}

	Object.keys(maybeSchemaOrRecord).forEach((status): TSchema | undefined => {
		const maybeNameOrSchema = maybeSchemaOrRecord[+status]

		if (typeof maybeNameOrSchema === 'string') {
			if (maybeNameOrSchema in models) {
				const schema = models[maybeNameOrSchema]
				schema.type === 'object' &&
					'additionalProperties' in schema === false

				// Inherits model maybe already compiled
				record[+status] =
					Kind in schema
						? getSchemaValidator(schema, {
								modules,
								models,
								additionalProperties,
								dynamic,
								normalize,
								coerce: false,
								additionalCoerce: []
							})
						: schema
			}

			return undefined
		}

		if (
			maybeNameOrSchema.type === 'object' &&
			'additionalProperties' in maybeNameOrSchema === false
		)
			maybeNameOrSchema.additionalProperties = additionalProperties

		// Inherits model maybe already compiled
		record[+status] =
			Kind in maybeNameOrSchema
				? getSchemaValidator(maybeNameOrSchema as TSchema, {
						modules,
						models,
						additionalProperties,
						dynamic,
						normalize,
						coerce: false,
						additionalCoerce: []
					})
				: maybeNameOrSchema
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
	models
}: {
	validator: TSchema | string | undefined
	modules: TModule<any, any>
	defaultConfig: CookieOptions | undefined
	config: CookieOptions
	dynamic: boolean
	models: Record<string, TSchema> | undefined
}) => {
	let cookieValidator = getSchemaValidator(validator, {
		modules,
		dynamic,
		models,
		additionalProperties: true,
		coerce: true,
		additionalCoerce: stringToStructureCoercions()
	})

	if (isNotEmpty(defaultConfig)) {
		if (cookieValidator)
			cookieValidator.config = mergeCookie(cookieValidator.config, config)
		else {
			cookieValidator = getSchemaValidator(t.Cookie({}), {
				modules,
				dynamic,
				models,
				additionalProperties: true
			})

			cookieValidator.config = defaultConfig
		}
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
// 	const schema = validator?.schema

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

export const createAccelerators = (
	records: Record<number, ElysiaTypeCheck<any>>
) => {
	const accelerators = <Record<number, Function>>{}

	for (const [id, validator] of Object.entries(records)) {
		if (!validator) continue

		accelerators[+id] = createAccelerator(validator.schema)
	}

	return accelerators
}
