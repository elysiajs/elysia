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

import { mergeCookie, randomId } from './utils'
import { mapValueError } from './error'

import type { CookieOptions } from './cookies'
import type {
	ElysiaConfig,
	InputSchema,
	MaybeArray,
	StandaloneInputSchema
} from './types'

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

const createCleaner = (schema: TAnySchema) => (value: unknown) => {
	if (typeof value === 'object')
		try {
			return Value.Clean(schema, value)
		} catch {}

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
		additionalCoerce = [],
		validators,
		sanitize
	}: {
		models?: Record<string, TSchema>
		modules?: TModule<any, any>
		additionalProperties?: boolean
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

	const mapSchema = (s: string | TSchema | undefined): TSchema => {
		let schema: TSchema

		if (!s) return undefined as any

		if (typeof s !== 'string') schema = s
		else {
			// if (s in caches) return caches[s] as any

			const isArray = s.endsWith('[]')
			const key = isArray ? s.substring(0, s.length - 2) : s

			schema =
				(modules as TModule<{}, {}> | undefined)?.Import(
					key as never
				) ?? models[key]

			if (isArray) schema = t.Array(schema)
		}

		if (!schema) return undefined as any

		let _doesHaveRef: boolean
		if (schema[Kind] !== 'Import' && (_doesHaveRef = hasRef(schema))) {
			const id = randomId()

			if (doesHaveRef === undefined) doesHaveRef = _doesHaveRef

			const model: any = t.Module({
				// @ts-expect-error private property
				...modules?.$defs,
				[id]: schema
			})

			schema = model.Import(id)
		}

		if (schema[Kind] === 'Import') {
			const newDefs: Record<string, TSchema> = {}

			for (const [key, value] of Object.entries(schema.$defs))
				newDefs[key] = replaceSchema(value as TSchema)

			const key = schema.$ref
			schema = t.Module(newDefs).Import(key)
		} else if (coerce || additionalCoerce) schema = replaceSchema(schema)

		return schema
	}

	let schema = mapSchema(s)

	if (validators?.length) {
		let hasAdditional = false

		const { schema: mergedObjectSchema, notObjects } = mergeObjectSchemas([
			schema,
			...validators.map(mapSchema)
		])

		if (notObjects) {
			schema = t.Intersect([
				...(mergedObjectSchema ? [mergedObjectSchema] : []),
				...notObjects.map((x) => {
					const schema = mapSchema(x)

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
			'additionalProperties' in schema === false
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
			get hasAdditionalProperties() {
				if ('~hasAdditionalProperties' in this)
					return this['~hasAdditionalProperties'] as boolean

				return (this['~hasAdditionalProperties'] =
					hasAdditionalProperties(schema))
			},
			get hasDefault() {
				if ('~hasDefault' in this) return this['~hasDefault']

				return (this['~hasDefault'] = hasProperty('default', schema))
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

		if (normalize && schema.additionalProperties === false) {
			if (normalize === true || normalize === 'exactMirror') {
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
					validator.Clean = createCleaner(schema)
				}
			} else validator.Clean = createCleaner(schema)
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

	const compiled = TypeCompiler.Compile(
		schema,
		Object.values(models)
	) as any as ElysiaTypeCheck<any>

	if (schema.config) {
		compiled.config = schema.config

		if (compiled?.schema?.config) delete compiled.schema.config
	}

	if (normalize === true || normalize === 'exactMirror') {
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

			compiled.Clean = createCleaner(schema)
		}
	} else if (normalize === 'typebox') compiled.Clean = createCleaner(schema)

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
			required: [...(newSchema?.required ?? []), ...schema.required]
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
		models?: Record<string, TSchema>
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

	let maybeSchemaOrRecord: TSchema | Record<number, string | TSchema>

	if (typeof s !== 'string') maybeSchemaOrRecord = s!
	else {
		const isArray = s.endsWith('[]')
		const key = isArray ? s.substring(0, s.length - 2) : s

		maybeSchemaOrRecord =
			(modules as TModule<{}, {}>).Import(key as never) ?? models[key]

		if (isArray)
			maybeSchemaOrRecord = t.Array(maybeSchemaOrRecord as TSchema)
	}

	if (!maybeSchemaOrRecord) return

	if (Kind in maybeSchemaOrRecord) {
		return {
			200: getSchemaValidator(maybeSchemaOrRecord, {
				modules,
				models,
				additionalProperties,
				dynamic,
				normalize,
				coerce: false,
				additionalCoerce: [],
				validators: validators.map((x) => x![200]),
				sanitize
			})
		}
	}

	const record: Record<number, ElysiaTypeCheck<any>> = {}

	Object.keys(maybeSchemaOrRecord).forEach((status): TSchema | undefined => {
		if (isNaN(+status)) return

		const maybeNameOrSchema = maybeSchemaOrRecord[+status]

		if (typeof maybeNameOrSchema === 'string') {
			if (maybeNameOrSchema in models) {
				const schema = models[maybeNameOrSchema]

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
								additionalCoerce: [],
								validators: validators.map((x) => x![+status]),
								sanitize
							})
						: schema
			}

			return undefined
		}

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
						additionalCoerce: [],
						validators: validators.map((x) => x![+status]),
						sanitize
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
	normalize = false,
	models,
	validators,
	sanitize
}: {
	validator: TSchema | string | undefined
	modules: TModule<any, any>
	defaultConfig: CookieOptions | undefined
	config: CookieOptions
	dynamic: boolean
	normalize: ElysiaConfig<''>['normalize'] | undefined
	models: Record<string, TSchema> | undefined
	validators?: InputSchema['cookie'][]
	sanitize?: () => ExactMirrorInstruction['sanitize']
}) => {
	let cookieValidator = getSchemaValidator(validator, {
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
	schema[Kind] === 'Import' && schema.$defs[schema.$ref][Kind] === 'Object'
		? schema.$defs[schema.$ref]
		: schema
