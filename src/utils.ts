import type { BunFile } from 'bun'
import {
	Kind,
	TAnySchema,
	TModule,
	TransformKind,
	type TSchema
} from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { TypeCheck, TypeCompiler } from '@sinclair/typebox/compiler'

import { t } from './type-system'
import type { Sucrose } from './sucrose'

import { mapValueError } from './error'

import type { TraceHandler } from './trace'
import type { CookieOptions } from './cookies'

import type {
	LifeCycleStore,
	MaybeArray,
	InputSchema,
	BaseMacro,
	LifeCycleType,
	HookContainer,
	GracefulHandler,
	PreHandler,
	BodyHandler,
	TransformHandler,
	OptionalHandler,
	AfterHandler,
	MapResponse,
	ErrorHandler,
	Replace,
	AfterResponseHandler,
	SchemaValidator,
	AnyLocalHook
} from './types'

export const hasHeaderShorthand = 'toJSON' in new Headers()

export const replaceUrlPath = (url: string, pathname: string) => {
	const urlObject = new URL(url)
	urlObject.pathname = pathname
	return urlObject.toString()
}

export const isClass = (v: Object) =>
	(typeof v === 'function' && /^\s*class\s+/.test(v.toString())) ||
	// Handle Object.create(null)
	(v.toString &&
		// Handle import * as Sentry from '@sentry/bun'
		// This also handle [object Date], [object Array]
		// and FFI value like [object Prisma]
		v.toString().startsWith('[object ') &&
		v.toString() !== '[object Object]') ||
	// If object prototype is not pure, then probably a class-like object
	isNotEmpty(Object.getPrototypeOf(v))

const isObject = (item: any): item is Object =>
	item && typeof item === 'object' && !Array.isArray(item)

export const mergeDeep = <
	A extends Record<string, any>,
	B extends Record<string, any>
>(
	target: A,
	source: B,
	{
		skipKeys,
		override = true
	}: {
		skipKeys?: string[]
		override?: boolean
	} = {}
): A & B => {
	if (!isObject(target) || !isObject(source)) return target as A & B

	for (const [key, value] of Object.entries(source)) {
		if (skipKeys?.includes(key)) continue

		if (!isObject(value) || !(key in target) || isClass(value)) {
			if (override || !(key in target))
				target[key as keyof typeof target] = value

			continue
		}

		target[key as keyof typeof target] = mergeDeep(
			(target as any)[key] as any,
			value,
			{ skipKeys, override }
		)
	}

	return target as A & B
}
export const mergeCookie = <const A extends Object, const B extends Object>(
	a: A,
	b: B
): A & B => {
	const v = mergeDeep(Object.assign({}, a), b, {
		skipKeys: ['properties']
	}) as A & B

	if ('properties' in v) delete v.properties

	return v
}

export const mergeObjectArray = <T extends HookContainer>(
	a: T | T[] = [],
	b: T | T[] = []
): T[] | undefined => {
	if (!a) return undefined
	if (!b) return a as any

	// ! Must copy to remove side-effect
	const array = <T[]>[]
	const checksums = <(number | undefined)[]>[]

	if (!Array.isArray(a)) a = [a]
	if (!Array.isArray(b)) b = [b]

	for (const item of a) {
		array.push(item)

		if (item.checksum) checksums.push(item.checksum)
	}

	for (const item of b)
		if (!checksums.includes(item.checksum)) array.push(item)

	return array
}

export const primitiveHooks = [
	'start',
	'request',
	'parse',
	'transform',
	'resolve',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'trace',
	'error',
	'stop',
	'body',
	'headers',
	'params',
	'query',
	'response',
	'type',
	'detail'
] as const

const primitiveHookMap = primitiveHooks.reduce(
	(acc, x) => ((acc[x] = true), acc),
	{} as Record<string, boolean>
)

export const mergeResponse = (
	a: InputSchema['response'],
	b: InputSchema['response']
) => {
	// If both are Record<number, ...> then merge them,
	// giving preference to b.
	type RecordNumber = Record<number, any>
	const isRecordNumber = (x: typeof a | typeof b): x is RecordNumber =>
		typeof x === 'object' && Object.keys(x).every(isNumericString)

	if (isRecordNumber(a) && isRecordNumber(b)) return Object.assign(a, b)
	else if (a && !isRecordNumber(a) && isRecordNumber(b))
		return Object.assign({ 200: a }, b)

	return b ?? a
}

export const mergeSchemaValidator = (
	a?: SchemaValidator | null,
	b?: SchemaValidator | null
): SchemaValidator => {
	return {
		body: b?.body ?? a?.body,
		headers: b?.headers ?? a?.headers,
		params: b?.params ?? a?.params,
		query: b?.query ?? a?.query,
		cookie: b?.cookie ?? a?.cookie,
		// @ts-ignore ? This order is correct - SaltyAom
		response: mergeResponse(
			// @ts-ignore
			a?.response,
			// @ts-ignore
			b?.response
		)
	}
}

export const mergeHook = (
	a?: Partial<LifeCycleStore>,
	b?: AnyLocalHook
	// { allowMacro = false }: { allowMacro?: boolean } = {}
): LifeCycleStore => {
	// In case if merging union is need
	// const customAStore: Record<string, unknown> = {}
	// const customBStore: Record<string, unknown> = {}

	// for (const [key, value] of Object.entries(a)) {
	// 	if (primitiveHooks.includes(key as any)) continue

	// 	customAStore[key] = value
	// }

	// for (const [key, value] of Object.entries(b)) {
	// 	if (primitiveHooks.includes(key as any)) continue

	// 	customBStore[key] = value
	// }

	// const unioned = Object.keys(customAStore).filter((x) =>
	// 	Object.keys(customBStore).includes(x)
	// )

	// // Must provide empty object to prevent reference side-effect
	// const customStore = Object.assign({}, customAStore, customBStore)

	// for (const union of unioned)
	// 	customStore[union] = mergeObjectArray(
	// 		customAStore[union],
	// 		customBStore[union]
	// 	)

	// @ts-expect-error
	const { resolve: resolveA, ...restA } = a ?? {}
	const { resolve: resolveB, ...restB } = b ?? {}

	return {
		...restA,
		...restB,
		// Merge local hook first
		// @ts-ignore
		body: b?.body ?? a?.body,
		// @ts-ignore
		headers: b?.headers ?? a?.headers,
		// @ts-ignore
		params: b?.params ?? a?.params,
		// @ts-ignore
		query: b?.query ?? a?.query,
		// @ts-ignore
		cookie: b?.cookie ?? a?.cookie,
		// ? This order is correct - SaltyAom
		response: mergeResponse(
			// @ts-ignore
			a?.response,
			// @ts-ignore
			b?.response
		),
		type: a?.type || b?.type,
		detail: mergeDeep(
			// @ts-ignore
			b?.detail ?? {},
			// @ts-ignore
			a?.detail ?? {}
		),
		parse: mergeObjectArray(a?.parse as any, b?.parse),
		transform: mergeObjectArray(a?.transform, b?.transform),
		beforeHandle: mergeObjectArray(
			mergeObjectArray(
				fnToContainer(resolveA, 'resolve'),
				a?.beforeHandle
			),
			mergeObjectArray(
				fnToContainer(resolveB, 'resolve'),
				b?.beforeHandle
			)
		),
		afterHandle: mergeObjectArray(a?.afterHandle, b?.afterHandle),
		mapResponse: mergeObjectArray(a?.mapResponse, b?.mapResponse) as any,
		afterResponse: mergeObjectArray(
			a?.afterResponse,
			b?.afterResponse
		) as any,
		trace: mergeObjectArray(a?.trace, b?.trace) as any,
		error: mergeObjectArray(a?.error, b?.error)
	}
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

	if (schema.not) {
		for (let i = 0; i < schema.not.length; i++)
			schema.not[i] = _replaceSchemaType(schema.not[i], options, root)

		return schema
	}

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
		else if (to.not)
			for (let i = 0; i < to.not.length; i++)
				to.not[i] = composeProperties(to.not[i])

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
					else if (to.not)
						for (let i = 0; i < to.not.length; i++)
							to.not[i] = { ...rest, ...to.not[i] }

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
): T extends TSchema ? TypeCheck<TSchema> : undefined => {
	if (!s) return undefined as any

	let schema: TSchema

	if (typeof s !== 'string') schema = s
	else {
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

	// @ts-ignore
	if (schema.type === 'object' && 'additionalProperties' in schema === false)
		schema.additionalProperties = additionalProperties

	if (dynamic) {
		const validator = {
			schema,
			references: '',
			checkFunc: () => {},
			code: '',
			Check: (value: unknown) => Value.Check(schema, value),
			Errors: (value: unknown) => Value.Errors(schema, value),
			Code: () => '',
			Clean: createCleaner(schema),
			Decode: (value: unknown) => Value.Decode(schema, value),
			Encode: (value: unknown) => Value.Encode(schema, value)
		} as unknown as TypeCheck<TSchema>

		if (normalize && schema.additionalProperties === false)
			// @ts-ignore
			validator.Clean = createCleaner(schema)

		// @ts-ignore
		if (schema.config) {
			// @ts-ignore
			validator.config = schema.config

			// @ts-ignore
			if (validator?.schema?.config)
				// @ts-ignore
				delete validator.schema.config
		}

		// @ts-ignore
		validator.parse = (v) => {
			try {
				return validator.Decode(v)
			} catch (error) {
				throw [...validator.Errors(v)].map(mapValueError)
			}
		}

		// @ts-ignore
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

		return validator as any
	}

	const compiled = TypeCompiler.Compile(schema, Object.values(models))

	// @ts-expect-error
	compiled.Clean = createCleaner(schema)

	// @ts-ignore
	if (schema.config) {
		// @ts-ignore
		compiled.config = schema.config

		// @ts-ignore
		if (compiled?.schema?.config)
			// @ts-ignore
			delete compiled.schema.config
	}

	// @ts-ignore
	compiled.parse = (v) => {
		try {
			return compiled.Decode(v)
		} catch (error) {
			throw [...compiled.Errors(v)].map(mapValueError)
		}
	}

	// @ts-ignore
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
): Record<number, TypeCheck<any>> | undefined => {
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

	const compile = (schema: TSchema, references?: TSchema[]) => {
		if (dynamic)
			return {
				schema,
				references: '',
				checkFunc: () => {},
				code: '',
				Check: (value: unknown) => Value.Check(schema, value),
				Errors: (value: unknown) => Value.Errors(schema, value),
				Code: () => '',
				Clean: createCleaner(schema),
				Decode: (value: unknown) => Value.Decode(schema, value),
				Encode: (value: unknown) => Value.Encode(schema, value)
			} as unknown as TypeCheck<TSchema>

		const compiledValidator = TypeCompiler.Compile(schema, references)

		if (normalize && schema.additionalProperties === false)
			// @ts-ignore
			compiledValidator.Clean = createCleaner(schema)

		return compiledValidator
	}

	const modelValues = Object.values(models)

	if (Kind in maybeSchemaOrRecord) {
		if ('additionalProperties' in maybeSchemaOrRecord === false)
			maybeSchemaOrRecord.additionalProperties = additionalProperties

		return {
			200: compile(maybeSchemaOrRecord, modelValues)
		}
	}

	const record: Record<number, TypeCheck<any>> = {}

	Object.keys(maybeSchemaOrRecord).forEach((status): TSchema | undefined => {
		const maybeNameOrSchema = maybeSchemaOrRecord[+status]

		if (typeof maybeNameOrSchema === 'string') {
			if (maybeNameOrSchema in models) {
				const schema = models[maybeNameOrSchema]
				schema.type === 'object' &&
					'additionalProperties' in schema === false

				// Inherits model maybe already compiled
				record[+status] =
					Kind in schema ? compile(schema, modelValues) : schema
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
				? compile(maybeNameOrSchema, modelValues)
				: maybeNameOrSchema
	})

	return record
}

const isBun = typeof Bun !== 'undefined'
const hasHash = isBun && typeof Bun.hash === 'function'

// https://stackoverflow.com/a/52171480
export const checksum = (s: string) => {
	if (hasHash) return Bun.hash(s) as number

	let h = 9

	for (let i = 0; i < s.length; ) h = Math.imul(h ^ s.charCodeAt(i++), 9 ** 9)

	return (h = h ^ (h >>> 9))
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
		if (cookieValidator) {
			// @ts-expect-error private
			cookieValidator.config = mergeCookie(
				// @ts-expect-error private
				cookieValidator.config,
				config
			)
		} else {
			cookieValidator = getSchemaValidator(t.Cookie({}), {
				modules,
				dynamic,
				models,
				additionalProperties: true
			})

			// @ts-expect-error private
			cookieValidator.config = defaultConfig
		}
	}

	return cookieValidator
}

export const injectChecksum = (
	checksum: number | undefined,
	x: MaybeArray<HookContainer> | undefined
) => {
	if (!x) return

	if (!Array.isArray(x)) {
		// ? clone fn is required to prevent side-effect from changing hookType
		const fn = x

		if (checksum && !fn.checksum) fn.checksum = checksum
		if (fn.scope === 'scoped') fn.scope = 'local'

		return fn
	}

	// ? clone fns is required to prevent side-effect from changing hookType
	const fns = [...x]

	for (const fn of fns) {
		if (checksum && !fn.checksum) fn.checksum = checksum

		if (fn.scope === 'scoped') fn.scope = 'local'
	}

	return fns
}

export const mergeLifeCycle = (
	a: Partial<LifeCycleStore>,
	b: Partial<LifeCycleStore | AnyLocalHook>,
	checksum?: number
): LifeCycleStore => {
	return {
		start: mergeObjectArray(
			a.start,
			injectChecksum(checksum, b?.start)
		) as HookContainer<GracefulHandler<any>>[],
		request: mergeObjectArray(
			a.request,
			injectChecksum(checksum, b?.request)
		) as HookContainer<PreHandler<any, any>>[],
		parse: mergeObjectArray(
			a.parse,
			injectChecksum(checksum, b?.parse)
		) as HookContainer<BodyHandler<any, any>>[],
		transform: mergeObjectArray(
			a.transform,
			injectChecksum(checksum, b?.transform)
		) as HookContainer<TransformHandler<any, any>>[],
		beforeHandle: mergeObjectArray(
			mergeObjectArray(
				// @ts-ignore
				fnToContainer(a.resolve, 'resolve'),
				a.beforeHandle
			),
			injectChecksum(
				checksum,
				mergeObjectArray(
					fnToContainer(b?.resolve, 'resolve'),
					b?.beforeHandle
				)
			)
		) as HookContainer<OptionalHandler<any, any>>[],
		afterHandle: mergeObjectArray(
			a.afterHandle,
			injectChecksum(checksum, b?.afterHandle)
		) as HookContainer<AfterHandler<any, any>>[],
		mapResponse: mergeObjectArray(
			a.mapResponse,
			injectChecksum(checksum, b?.mapResponse)
		) as HookContainer<MapResponse<any, any>>[],
		afterResponse: mergeObjectArray(
			a.afterResponse,
			injectChecksum(checksum, b?.afterResponse)
		) as HookContainer<AfterResponseHandler<any, any>>[],
		// Already merged on Elysia._use, also logic is more complicated, can't directly merge
		trace: mergeObjectArray(
			a.trace,
			injectChecksum(checksum, b?.trace)
		) as HookContainer<TraceHandler<any, any>>[],
		error: mergeObjectArray(
			a.error,
			injectChecksum(checksum, b?.error)
		) as HookContainer<ErrorHandler<any, any, any>>[],
		stop: mergeObjectArray(
			a.stop,
			injectChecksum(checksum, b?.stop)
		) as HookContainer<GracefulHandler<any>>[]
	}
}

export const asHookType = (
	fn: HookContainer,
	inject: LifeCycleType,
	{ skipIfHasType = false }: { skipIfHasType?: boolean } = {}
) => {
	if (!fn) return fn

	if (!Array.isArray(fn)) {
		if (skipIfHasType) fn.scope ??= inject
		else fn.scope = inject

		return fn
	}

	for (const x of fn)
		if (skipIfHasType) x.scope ??= inject
		else x.scope = inject

	return fn
}

const filterGlobal = (fn: MaybeArray<HookContainer>) => {
	if (!fn) return fn

	if (!Array.isArray(fn))
		switch (fn.scope) {
			case 'global':
			case 'scoped':
				return { ...fn }

			default:
				return { fn }
		}

	const array = <any>[]

	for (const x of fn)
		switch (x.scope) {
			case 'global':
			case 'scoped':
				array.push({
					...x
				})
				break
		}

	return array
}

export const filterGlobalHook = (hook: AnyLocalHook): AnyLocalHook => {
	return {
		// rest is validator
		...hook,
		type: hook?.type,
		detail: hook?.detail,
		parse: filterGlobal(hook?.parse),
		transform: filterGlobal(hook?.transform),
		beforeHandle: filterGlobal(hook?.beforeHandle),
		afterHandle: filterGlobal(hook?.afterHandle),
		mapResponse: filterGlobal(hook?.mapResponse),
		afterResponse: filterGlobal(hook?.afterResponse),
		error: filterGlobal(hook?.error),
		trace: filterGlobal(hook?.trace)
	}
}

export const StatusMap = {
	Continue: 100,
	'Switching Protocols': 101,
	Processing: 102,
	'Early Hints': 103,
	OK: 200,
	Created: 201,
	Accepted: 202,
	'Non-Authoritative Information': 203,
	'No Content': 204,
	'Reset Content': 205,
	'Partial Content': 206,
	'Multi-Status': 207,
	'Already Reported': 208,
	'Multiple Choices': 300,
	'Moved Permanently': 301,
	Found: 302,
	'See Other': 303,
	'Not Modified': 304,
	'Temporary Redirect': 307,
	'Permanent Redirect': 308,
	'Bad Request': 400,
	Unauthorized: 401,
	'Payment Required': 402,
	Forbidden: 403,
	'Not Found': 404,
	'Method Not Allowed': 405,
	'Not Acceptable': 406,
	'Proxy Authentication Required': 407,
	'Request Timeout': 408,
	Conflict: 409,
	Gone: 410,
	'Length Required': 411,
	'Precondition Failed': 412,
	'Payload Too Large': 413,
	'URI Too Long': 414,
	'Unsupported Media Type': 415,
	'Range Not Satisfiable': 416,
	'Expectation Failed': 417,
	"I'm a teapot": 418,
	'Misdirected Request': 421,
	'Unprocessable Content': 422,
	Locked: 423,
	'Failed Dependency': 424,
	'Too Early': 425,
	'Upgrade Required': 426,
	'Precondition Required': 428,
	'Too Many Requests': 429,
	'Request Header Fields Too Large': 431,
	'Unavailable For Legal Reasons': 451,
	'Internal Server Error': 500,
	'Not Implemented': 501,
	'Bad Gateway': 502,
	'Service Unavailable': 503,
	'Gateway Timeout': 504,
	'HTTP Version Not Supported': 505,
	'Variant Also Negotiates': 506,
	'Insufficient Storage': 507,
	'Loop Detected': 508,
	'Not Extended': 510,
	'Network Authentication Required': 511
} as const

export const InvertedStatusMap = Object.fromEntries(
	Object.entries(StatusMap).map(([k, v]) => [v, k])
) as {
	[K in keyof StatusMap as StatusMap[K]]: K
}

export type StatusMap = typeof StatusMap
export type InvertedStatusMap = typeof InvertedStatusMap

function removeTrailingEquals(digest: string): string {
	let trimmedDigest = digest
	while (trimmedDigest.endsWith('=')) {
		trimmedDigest = trimmedDigest.slice(0, -1)
	}
	return trimmedDigest
}

const encoder = new TextEncoder()

export const signCookie = async (val: string, secret: string | null) => {
	if (typeof val !== 'string')
		throw new TypeError('Cookie value must be provided as a string.')

	if (secret === null) throw new TypeError('Secret key must be provided.')

	const secretKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	)
	const hmacBuffer = await crypto.subtle.sign(
		'HMAC',
		secretKey,
		encoder.encode(val)
	)

	return (
		val +
		'.' +
		removeTrailingEquals(Buffer.from(hmacBuffer).toString('base64'))
	)
}

export const unsignCookie = async (input: string, secret: string | null) => {
	if (typeof input !== 'string')
		throw new TypeError('Signed cookie string must be provided.')

	if (null === secret) throw new TypeError('Secret key must be provided.')

	const tentativeValue = input.slice(0, input.lastIndexOf('.'))
	const expectedInput = await signCookie(tentativeValue, secret)

	return expectedInput === input ? tentativeValue : false
}

export const traceBackMacro = (
	extension: unknown,
	property: Record<string, unknown>,
	manage: ReturnType<typeof createMacroManager>
) => {
	if (!extension || typeof extension !== 'object' || !property) return

	for (const [key, value] of Object.entries(property)) {
		if (key in primitiveHookMap || !(key in extension)) continue

		const v = extension[
			key as unknown as keyof typeof extension
		] as BaseMacro[string]

		if (typeof v === 'function') {
			const hook = v(value)

			if (typeof hook === 'object') {
				for (const [k, v] of Object.entries(hook)) {
					manage(k as keyof LifeCycleStore)({
						fn: v as any
					})
				}
			}
		}

		delete property[key as unknown as keyof typeof extension]
	}
}

export const createMacroManager =
	({
		globalHook,
		localHook
	}: {
		globalHook: Partial<LifeCycleStore>
		localHook: Partial<AnyLocalHook>
	}) =>
	(stackName: keyof LifeCycleStore) =>
	(
		type:
			| {
					insert?: 'before' | 'after'
					stack?: 'global' | 'local'
			  }
			| MaybeArray<HookContainer>,
		fn?: MaybeArray<HookContainer>
	) => {
		if (typeof type === 'function')
			type = {
				fn: type
			}

		// @ts-expect-error this is available in macro v2
		if (stackName === 'resolve') {
			type = {
				...type,
				subType: 'resolve'
			}
		}

		if ('fn' in type || Array.isArray(type)) {
			if (!localHook[stackName]) localHook[stackName] = []
			if (typeof localHook[stackName] === 'function')
				localHook[stackName] = [localHook[stackName]]

			if (Array.isArray(type))
				localHook[stackName] = (
					localHook[stackName] as unknown[]
				).concat(type) as any
			else localHook[stackName].push(type)

			return
		}

		const { insert = 'after', stack = 'local' } = type

		if (typeof fn === 'function') fn = { fn }

		if (stack === 'global') {
			if (!Array.isArray(fn)) {
				if (insert === 'before') {
					;(globalHook[stackName] as any[]).unshift(fn)
				} else {
					;(globalHook[stackName] as any[]).push(fn)
				}
			} else {
				if (insert === 'before') {
					globalHook[stackName] = fn.concat(
						globalHook[stackName] as any
					) as any
				} else {
					globalHook[stackName] = (
						globalHook[stackName] as any[]
					).concat(fn)
				}
			}
		} else {
			if (!localHook[stackName]) localHook[stackName] = []
			if (typeof localHook[stackName] === 'function')
				localHook[stackName] = [localHook[stackName]]

			if (!Array.isArray(fn)) {
				if (insert === 'before') {
					;(localHook[stackName] as any[]).unshift(fn)
				} else {
					;(localHook[stackName] as any[]).push(fn)
				}
			} else {
				if (insert === 'before') {
					localHook[stackName] = fn.concat(localHook[stackName])
				} else {
					localHook[stackName] = localHook[stackName].concat(fn)
				}
			}
		}
	}

const parseNumericString = (message: string | number): number | null => {
	if (typeof message === 'number') return message

	if (message.length < 16) {
		if (message.trim().length === 0) return null

		const length = Number(message)
		if (Number.isNaN(length)) return null

		return length
	}

	// if 16 digit but less then 9,007,199,254,740,991 then can be parsed
	if (message.length === 16) {
		if (message.trim().length === 0) return null

		const number = Number(message)
		if (Number.isNaN(number) || number.toString() !== message) return null

		return number
	}

	return null
}

export const isNumericString = (message: string | number): boolean =>
	parseNumericString(message) !== null

export class PromiseGroup implements PromiseLike<void> {
	root: Promise<any> | null = null
	promises: Promise<any>[] = []

	constructor(public onError: (error: any) => void = console.error) {}

	/**
	 * The number of promises still being awaited.
	 */
	get size() {
		return this.promises.length
	}

	/**
	 * Add a promise to the group.
	 * @returns The promise that was added.
	 */
	add<T>(promise: Promise<T>) {
		this.promises.push(promise)
		this.root ||= this.drain()
		return promise
	}

	private async drain() {
		while (this.promises.length > 0) {
			try {
				await this.promises[0]
			} catch (error) {
				this.onError(error)
			}
			this.promises.shift()
		}
		this.root = null
	}

	// Allow the group to be awaited.
	then<TResult1 = void, TResult2 = never>(
		onfulfilled?:
			| ((value: void) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null,
		onrejected?:
			| ((reason: any) => TResult2 | PromiseLike<TResult2>)
			| undefined
			| null
	): PromiseLike<TResult1 | TResult2> {
		return (this.root ?? Promise.resolve()).then(onfulfilled, onrejected)
	}
}

export const fnToContainer = (
	fn: MaybeArray<Function | HookContainer>,
	/** Only add subType to non contained fn */
	subType?: HookContainer['subType']
): MaybeArray<HookContainer> => {
	if (!fn) return fn

	if (!Array.isArray(fn)) {
		// parse can be a label since 1.2.0
		if (typeof fn === 'function' || typeof fn === 'string')
			return subType ? { fn, subType } : { fn }
		else if ('fn' in fn) return fn
	}

	const fns = <HookContainer[]>[]
	for (const x of fn) {
		// parse can be a label since 1.2.0
		if (typeof x === 'function' || typeof x === 'string')
			fns.push(subType ? { fn: x, subType } : { fn: x })
		else if ('fn' in x) fns.push(x)
	}

	return fns
}

export const localHookToLifeCycleStore = (a: AnyLocalHook): LifeCycleStore => {
	return {
		...a,
		start: fnToContainer(a?.start),
		request: fnToContainer(a?.request),
		parse: fnToContainer(a?.parse),
		transform: fnToContainer(a?.transform),
		beforeHandle: fnToContainer(a?.beforeHandle),
		afterHandle: fnToContainer(a?.afterHandle),
		mapResponse: fnToContainer(a?.mapResponse),
		afterResponse: fnToContainer(a?.afterResponse),
		trace: fnToContainer(a?.trace),
		error: fnToContainer(a?.error),
		stop: fnToContainer(a?.stop)
	}
}

export const lifeCycleToFn = (a: Partial<LifeCycleStore>): AnyLocalHook => {
	const hook: Partial<HookContainer> = {}

	// @ts-expect-error
	if (a.start?.map) hook.start = a.start.map((x) => x.fn)
	// @ts-expect-error
	if (a.request?.map) hook.request = a.request.map((x) => x.fn)
	// @ts-expect-error
	if (a.parse?.map) hook.parse = a.parse.map((x) => x.fn)
	// @ts-expect-error
	if (a.transform?.map) hook.transform = a.transform.map((x) => x.fn)
	// @ts-expect-error
	if (a.beforeHandle?.map) hook.beforeHandle = a.beforeHandle.map((x) => x.fn)
	// @ts-expect-error
	if (a.afterHandle?.map) hook.afterHandle = a.afterHandle.map((x) => x.fn)
	// @ts-expect-error
	if (a.mapResponse?.map) hook.mapResponse = a.mapResponse.map((x) => x.fn)
	if (a.afterResponse?.map)
		// @ts-expect-error
		hook.afterResponse = a.afterResponse.map((x) => x.fn)
	// @ts-expect-error
	if (a.trace?.map) hook.trace = a.trace.map((x) => x.fn)
	// @ts-expect-error
	if (a.error?.map) hook.error = a.error.map((x) => x.fn)
	// @ts-expect-error
	if (a.stop?.map) hook.stop = a.stop.map((x) => x.fn)

	return hook
}

export const cloneInference = (inference: Sucrose.Inference) =>
	({
		body: inference.body,
		cookie: inference.cookie,
		headers: inference.headers,
		query: inference.query,
		set: inference.set,
		server: inference.server,
		request: inference.request,
		route: inference.route
	}) satisfies Sucrose.Inference

/**
 *
 * @param url URL to redirect to
 * @param HTTP status code to send,
 */
export const redirect = (
	url: string,
	status: 301 | 302 | 303 | 307 | 308 = 302
) => Response.redirect(url, status)

export type redirect = typeof redirect

export const ELYSIA_FORM_DATA = Symbol('ElysiaFormData')
export type ELYSIA_FORM_DATA = typeof ELYSIA_FORM_DATA

type ElysiaFormData<T extends Record<string | number, unknown>> = FormData & {
	[ELYSIA_FORM_DATA]: Replace<T, BunFile, File>
}

export const ELYSIA_REQUEST_ID = Symbol('ElysiaRequestId')
export type ELYSIA_REQUEST_ID = typeof ELYSIA_REQUEST_ID

export const form = <const T extends Record<string | number, unknown>>(
	items: T
): ElysiaFormData<T> => {
	const formData = new FormData()

	for (const [key, value] of Object.entries(items)) {
		if (Array.isArray(value)) {
			for (const v of value) {
				if (value instanceof File)
					formData.append(key, value, value.name)

				formData.append(key, v)
			}

			continue
		}

		if (value instanceof File) formData.append(key, value, value.name)
		formData.append(key, value)
	}

	return formData as any
}

export const randomId = () => {
	const uuid = crypto.randomUUID()
	return uuid.slice(0, 8) + uuid.slice(24, 32)
}

// ! Deduplicate current instance
export const deduplicateChecksum = <T extends Function>(
	array: HookContainer<T>[]
): HookContainer<T>[] => {
	const hashes: number[] = []

	for (let i = 0; i < array.length; i++) {
		const item = array[i]

		if (item.checksum) {
			if (hashes.includes(item.checksum)) {
				array.splice(i, 1)
				i--
			}

			hashes.push(item.checksum)
		}
	}

	return array
}

/**
 * Since it's a plugin, which means that ephemeral is demoted to volatile.
 * Which  means there's no volatile and all previous ephemeral become volatile
 * We can just promote back without worry
 */
export const promoteEvent = (
	events?: (HookContainer | Function)[],
	as: 'scoped' | 'global' = 'scoped'
): void => {
	if (!events) return

	if (as === 'scoped') {
		for (const event of events)
			if ('scope' in event && event.scope === 'local')
				event.scope = 'scoped'

		return
	}

	for (const event of events) if ('scope' in event) event.scope = 'global'
}

// type PropertyKeys<T> = {
// 	[K in keyof T]: T[K] extends (...args: any[]) => any ? never : K
// }[keyof T]

// type PropertiesOnly<T> = Pick<T, PropertyKeys<T>>

// export const classToObject = <T>(
// 	instance: T,
// 	processed: WeakMap<object, object> = new WeakMap()
// ): T extends object ? PropertiesOnly<T> : T => {
// 	if (typeof instance !== 'object' || instance === null)
// 		return instance as any

// 	if (Array.isArray(instance))
// 		return instance.map((x) => classToObject(x, processed)) as any

// 	if (processed.has(instance)) return processed.get(instance) as any

// 	const result: Partial<T> = {}

// 	for (const key of Object.keys(instance) as Array<keyof T>) {
// 		const value = instance[key]
// 		if (typeof value === 'object' && value !== null)
// 			result[key] = classToObject(value, processed) as T[keyof T]
// 		else result[key] = value
// 	}

// 	const prototype = Object.getPrototypeOf(instance)
// 	if (!prototype) return result as any

// 	const properties = Object.getOwnPropertyNames(prototype)

// 	for (const property of properties) {
// 		const descriptor = Object.getOwnPropertyDescriptor(
// 			Object.getPrototypeOf(instance),
// 			property
// 		)

// 		if (descriptor && typeof descriptor.get === 'function') {
// 			// ? Very important to prevent prototype pollution
// 			if (property === '__proto__') continue

// 			;(result as any)[property as keyof typeof instance] = classToObject(
// 				instance[property as keyof typeof instance]
// 			)
// 		}
// 	}

// 	return result as any
// }

export const getLoosePath = (path: string) => {
	if (path.charCodeAt(path.length - 1) === 47)
		return path.slice(0, path.length - 1)

	return path + '/'
}

export const isNotEmpty = (obj?: Object) => {
	if (!obj) return false

	for (const x in obj) return true

	return false
}

const isEmptyHookProperty = (prop: unknown) => {
	if (Array.isArray(prop)) return prop.length === 0

	return !prop
}

export const compressHistoryHook = (hook: LifeCycleStore) => {
	const history: Partial<LifeCycleStore> = { ...hook }

	if (isEmptyHookProperty(hook.afterHandle)) delete history.afterHandle
	if (isEmptyHookProperty(hook.afterResponse)) delete history.afterResponse
	if (isEmptyHookProperty(hook.beforeHandle)) delete history.beforeHandle
	if (isEmptyHookProperty(hook.error)) delete history.error
	if (isEmptyHookProperty(hook.mapResponse)) delete history.mapResponse
	if (isEmptyHookProperty(hook.parse)) delete history.parse
	if (isEmptyHookProperty(hook.request)) delete history.request
	if (isEmptyHookProperty(hook.start)) delete history.start
	if (isEmptyHookProperty(hook.stop)) delete history.stop
	if (isEmptyHookProperty(hook.trace)) delete history.trace
	if (isEmptyHookProperty(hook.transform)) delete history.transform

	if (!history.type) delete history.type
	// @ts-expect-error
	if (history.detail && !Object.keys(history.detail).length)
		// @ts-expect-error
		delete history.detail

	// @ts-expect-error
	if (!history.body) delete history.body
	// @ts-expect-error
	if (!history.cookie) delete history.cookie
	// @ts-expect-error
	if (!history.headers) delete history.headers
	// @ts-expect-error
	if (!history.query) delete history.query
	// @ts-expect-error
	if (!history.params) delete history.params
	// @ts-expect-error
	if (!history.response) delete history.response

	return history
}

export const decompressHistoryHook = (hook: Partial<LifeCycleStore>) => {
	const history = { ...hook } as LifeCycleStore

	if (!history.afterHandle) history.afterHandle = []
	if (!history.afterResponse) history.afterResponse = []
	if (!history.beforeHandle) history.beforeHandle = []
	if (!history.error) history.error = []
	if (!history.mapResponse) history.mapResponse = []
	if (!history.parse) history.parse = []
	if (!history.request) history.request = []
	if (!history.start) history.start = []
	if (!history.stop) history.stop = []
	if (!history.trace) history.trace = []
	if (!history.transform) history.transform = []

	// @ts-expect-error
	if (!history.body) history.body = undefined
	// @ts-expect-error
	if (!history.cookie) history.cookie = undefined
	// @ts-expect-error
	if (!history.headers) history.headers = undefined
	// @ts-expect-error
	if (!history.query) history.query = undefined
	// @ts-expect-error
	if (!history.params) history.params = undefined
	// @ts-expect-error
	if (!history.response) history.response = undefined

	return history
}

export const encodePath = (path: string, { dynamic = false } = {}) => {
	let encoded = encodeURIComponent(path).replace(/%2F/g, '/')

	if (dynamic) encoded = encoded.replace(/%3A/g, ':').replace(/%3F/g, '?')

	return encoded
}
