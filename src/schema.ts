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

import { mergeCookie, mergeDeep, randomId } from './utils'
import { mapValueError } from './error'

import type { CookieOptions } from './cookies'
import type {
	ElysiaConfig,
	InputSchema,
	MaybeArray,
	StandaloneInputSchema,
	StandardSchemaV1LikeValidate,
	UnwrapSchema
} from './types'

import type { StandardSchemaV1Like } from './types'
import {
	replaceSchemaTypeFromManyOptions,
	type ReplaceSchemaTypeOptions,
	stringToStructureCoercions
} from './replace-schema'

type MapValueError = ReturnType<typeof mapValueError>

export interface ElysiaTypeCheck<T extends TSchema>
	extends Omit<TypeCheck<T>, 'schema'> {
	provider: 'typebox' | 'standard'
	schema: T
	config: Object
	Clean?(v: unknown): UnwrapSchema<T>
	parse(v: unknown): UnwrapSchema<T>
	safeParse(v: unknown):
		| { success: true; data: UnwrapSchema<T>; error: null }
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

/**
 * Resolve a schema that might be a model reference (string) to the actual schema
 */
export const resolveSchema = (
	schema: TAnySchema | string | undefined,
	models?: Record<string, TAnySchema | StandardSchemaV1Like>,
	modules?: TModule<any, any>
): TAnySchema | StandardSchemaV1Like | undefined => {
	if (!schema) return undefined
	if (typeof schema !== 'string') return schema

	// Check modules first (higher priority)
	// @ts-expect-error private property
	if (modules && schema in modules.$defs) {
		return (modules as TModule<{}, {}>).Import(schema as never)
	}

	// Then check models
	return models?.[schema]
}

export const hasType = (type: string, schema: TAnySchema): boolean => {
	if (!schema) return false

	if (Kind in schema && schema[Kind] === type) return true

	// Handle Import/Ref schemas (unwrap)
	if (Kind in schema && schema[Kind] === 'Import') {
		if (schema.$defs && schema.$ref) {
			const ref = schema.$ref.replace('#/$defs/', '')
			if (schema.$defs[ref]) {
				return hasType(type, schema.$defs[ref])
			}
		}
	}

	if (schema.anyOf) return schema.anyOf.some((s: TSchema) => hasType(type, s))
	if (schema.oneOf) return schema.oneOf.some((s: TSchema) => hasType(type, s))
	if (schema.allOf) return schema.allOf.some((s: TSchema) => hasType(type, s))

	if (schema.type === 'array' && schema.items) {
		if (
			type === 'Files' &&
			Kind in schema.items &&
			schema.items[Kind] === 'File'
		) {
			return true
		}
		return hasType(type, schema.items)
	}

	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>
		if (!properties) return false

		for (const key of Object.keys(properties)) {
			if (hasType(type, properties[key])) return true
		}
	}

	return false
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
		if (!properties) return false

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
): boolean => {
	if (!_schema) return false

	// @ts-expect-error private property
	const schema = _schema.schema ?? _schema

	if (schema[Kind] === 'Import' && _schema.References)
		return _schema
			.References()
			.some((schema: TAnySchema) => hasProperty(expectedProperty, schema))

	if (schema.anyOf)
		return schema.anyOf.some((s: TSchema) =>
			hasProperty(expectedProperty, s)
		)
	if (schema.allOf)
		return schema.allOf.some((s: TSchema) =>
			hasProperty(expectedProperty, s)
		)
	if (schema.oneOf)
		return schema.oneOf.some((s: TSchema) =>
			hasProperty(expectedProperty, s)
		)

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

const createCleaner = (schema: TAnySchema) => (value: unknown) => {
	if (typeof value === 'object')
		try {
			return Value.Clean(schema, value)
		} catch {}

	return value
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
			return replaceSchemaTypeFromManyOptions(schema, [
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

		return replaceSchemaTypeFromManyOptions(schema, additionalCoerce)
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

		const hasAdditionalCoerce = Array.isArray(additionalCoerce)
			? additionalCoerce.length > 0
			: !!additionalCoerce

		if (Kind in schema) {
			if (schema[Kind] === 'Import') {
				if (!hasRef(schema.$defs[schema.$ref])) {
					schema = schema.$defs[schema.$ref] ?? models[schema.$ref]

					if (coerce || hasAdditionalCoerce) {
						schema = replaceSchema(schema as TSchema)

						if ('$id' in schema && !schema.$defs)
							schema.$id = `${schema.$id}_coerced_${randomId()}`
					}
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
				} else if (coerce || hasAdditionalCoerce)
					schema = replaceSchema(schema as TSchema)
			}
		}

		return schema
	}

	let schema = mapSchema(s)
	// console.log([s, schema])
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
			let mirror: Function
			if (normalize === true || normalize === 'exactMirror')
				try {
					mirror = createMirror(schema as TSchema, {
						TypeCompiler,
						sanitize: sanitize?.(),
						modules
					})
				} catch {
					console.warn(
						'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
					)
					console.warn(schema)
					mirror = createCleaner(schema as TSchema)
				}

			const vali = getSchemaValidator(schema, {
				models,
				modules,
				dynamic,
				normalize,
				additionalProperties: true,
				forceAdditionalProperties: true,
				coerce,
				additionalCoerce
			})!

			// @ts-ignore
			vali.Decode = mirror

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
			schema = replaceSchemaTypeFromManyOptions(schema, {
				onlyFirst: 'object',
				from: t.Object({}),
				to(schema) {
					if (!schema.properties) return schema
					if ('additionalProperties' in schema) return schema

					return t.Object(schema.properties, {
						...schema,
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
					if ('~hasDefault' in this) return this['~hasDefault']!

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
		} else if (normalize === 'typebox')
			compiled.Clean = createCleaner(schema)
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

// Returns all properties as a flat map, handling Union/Intersect
// See: https://github.com/sinclairzx81/typebox/blob/0.34.3/src/type/indexed/indexed.ts#L152-L162
export const getSchemaProperties = (
	schema: TAnySchema | undefined
): Record<string, TAnySchema> | undefined => {
	if (!schema) return undefined

	if (schema.properties) return schema.properties

	if (schema.allOf || schema.anyOf) {
		const members = schema.allOf ?? schema.anyOf
		const result: Record<string, TAnySchema> = {}
		for (const member of members) {
			const props = getSchemaProperties(member)
			if (props) Object.assign(result, props)
		}
		return Object.keys(result).length > 0 ? result : undefined
	}

	return undefined
}

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
