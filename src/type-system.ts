import { TypeRegistry, Type, FormatRegistry, TString } from '@sinclair/typebox'
import {
	ArrayOptions,
	DateOptions,
	Kind,
	NumberOptions,
	TArray,
	TDate,
	TUnsafe,
	TInteger,
	IntegerOptions,
	Unsafe,
	SchemaOptions,
	TSchema,
	TProperties,
	ObjectOptions,
	TObject,
	TNumber,
	TBoolean
} from '@sinclair/typebox'

import {
	type ValueError,
	type TypeCheck,
	TypeCompiler
} from '@sinclair/typebox/compiler'
import { Value } from '@sinclair/typebox/value'
import { fullFormats } from './formats'

import type { CookieOptions } from './cookies'
import { ValidationError } from './error'
import type { MaybeArray } from './types'

const isISO8601 =
	/(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/
const isFormalDate =
	/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{2}\s\d{4}\s\d{2}:\d{2}:\d{2}\sGMT(?:\+|-)\d{4}\s\([^)]+\)/
const isShortenDate =
	/^(?:(?:(?:(?:0?[1-9]|[12][0-9]|3[01])[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:19|20)\d{2})|(?:(?:19|20)\d{2}[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:0?[1-9]|[12][0-9]|3[01]))))(?:\s(?:1[012]|0?[1-9]):[0-5][0-9](?::[0-5][0-9])?(?:\s[AP]M)?)?$/

const _validateDate = fullFormats.date
const _validateDateTime = fullFormats['date-time']

if (!FormatRegistry.Has('date'))
	FormatRegistry.Set('date', (value: string) => {
		// Remove quote from stringified date
		const temp = value.replace(/"/g, '')

		if (
			isISO8601.test(temp) ||
			isFormalDate.test(temp) ||
			isShortenDate.test(temp) ||
			_validateDate(temp)
		) {
			const date = new Date(temp)
			if (!Number.isNaN(date.getTime())) return true
		}

		return false
	})

if (!FormatRegistry.Has('date-time'))
	FormatRegistry.Set('date-time', (value: string) => {
		// Remove quote from stringified date
		const temp = value.replace(/"/g, '')

		if (
			isISO8601.test(temp) ||
			isFormalDate.test(temp) ||
			isShortenDate.test(temp) ||
			_validateDateTime(temp)
		) {
			const date = new Date(temp)
			if (!Number.isNaN(date.getTime())) return true
		}

		return false
	})

Object.entries(fullFormats).forEach((formatEntry) => {
	const [formatName, formatValue] = formatEntry

	if (!FormatRegistry.Has(formatName)) {
		if (formatValue instanceof RegExp)
			FormatRegistry.Set(formatName, (value) => formatValue.test(value))
		else if (typeof formatValue === 'function')
			FormatRegistry.Set(formatName, formatValue)
	}
})

const t = Object.assign({}, Type)

export namespace ElysiaTypeOptions {
	export type Numeric = NumberOptions

	export type FileUnit = number | `${number}${'k' | 'm'}`

	export type StrictFileType =
		| 'image'
		| 'image/*'
		| 'image/jpeg'
		| 'image/png'
		| 'image/gif'
		| 'image/tiff'
		| 'image/x-icon'
		| 'image/svg'
		| 'image/webp'
		| 'image/avif'
		| 'audio'
		| 'audio/*'
		| 'audio/aac'
		| 'audio/mpeg'
		| 'audio/x-ms-wma'
		| 'audio/vnd.rn-realaudio'
		| 'audio/x-wav'
		| 'video'
		| 'video/*'
		| 'video/mpeg'
		| 'video/mp4'
		| 'video/quicktime'
		| 'video/x-ms-wmv'
		| 'video/x-msvideo'
		| 'video/x-flv'
		| 'video/webm'
		| 'text'
		| 'text/*'
		| 'text/css'
		| 'text/csv'
		| 'text/html'
		| 'text/javascript'
		| 'text/plain'
		| 'text/xml'
		| 'application'
		| 'application/*'
		| 'application/graphql'
		| 'application/graphql-response+json'
		| 'application/ogg'
		| 'application/pdf'
		| 'application/xhtml'
		| 'application/xhtml+html'
		| 'application/xml-dtd'
		| 'application/html'
		| 'application/json'
		| 'application/ld+json'
		| 'application/xml'
		| 'application/zip'
		| 'font'
		| 'font/*'
		| 'font/woff2'
		| 'font/woff'
		| 'font/ttf'
		| 'font/otf'

	export type FileType = (string & {}) | StrictFileType

	export interface File extends SchemaOptions {
		type?: MaybeArray<FileType>
		minSize?: FileUnit
		maxSize?: FileUnit
	}

	export interface Files extends File {
		minItems?: number
		maxItems?: number
	}

	export interface CookieValidatorOption<T extends Object = {}>
		extends ObjectOptions,
			CookieOptions {
		/**
		 * Secret key for signing cookie
		 *
		 * If array is passed, will use Key Rotation.
		 *
		 * Key rotation is when an encryption key is retired
		 * and replaced by generating a new cryptographic key.
		 */
		secrets?: string | string[]
		/**
		 * Specified cookie name to be signed globally
		 */
		sign?: Readonly<(keyof T | (string & {}))[]>
	}
}

const parseFileUnit = (size: ElysiaTypeOptions.FileUnit) => {
	if (typeof size === 'string')
		switch (size.slice(-1)) {
			case 'k':
				return +size.slice(0, size.length - 1) * 1024

			case 'm':
				return +size.slice(0, size.length - 1) * 1048576

			default:
				return +size
		}

	return size
}

const checkFileExtension = (type: string, extension: string) => {
	if (type.startsWith(extension)) return true

	return (
		extension.charCodeAt(extension.length - 1) === 42 &&
		extension.charCodeAt(extension.length - 2) === 47 &&
		type.startsWith(extension.slice(0, -1))
	)
}

const validateFile = (options: ElysiaTypeOptions.File, value: any) => {
	if (!(value instanceof Blob)) return false

	if (options.minSize && value.size < parseFileUnit(options.minSize))
		return false

	if (options.maxSize && value.size > parseFileUnit(options.maxSize))
		return false

	if (options.extension) {
		if (typeof options.extension === 'string')
			return checkFileExtension(value.type, options.extension)

		for (let i = 0; i < options.extension.length; i++)
			if (checkFileExtension(value.type, options.extension[i]))
				return true

		return false
	}

	return true
}

type ElysiaFile = (
	options?: Partial<ElysiaTypeOptions.Files> | undefined
) => TUnsafe<File>

const File: ElysiaFile = getOrSetType<ElysiaTypeOptions.File, ElysiaFile>(
	'File',
	validateFile
)

type ElysiaFiles = (
	options?: Partial<ElysiaTypeOptions.Files> | undefined
) => TUnsafe<File[]>

const Files: ElysiaFiles = getOrSetType<ElysiaTypeOptions.Files, ElysiaFiles>(
	'Files',
	(options, value) => {
		if (!Array.isArray(value)) return validateFile(options, value)

		if (options.minItems && value.length < options.minItems) return false

		if (options.maxItems && value.length > options.maxItems) return false

		for (let i = 0; i < value.length; i++)
			if (!validateFile(options, value[i])) return false

		return true
	}
)

if (!FormatRegistry.Has('numeric'))
	FormatRegistry.Set('numeric', (value) => !!value && !isNaN(+value))

if (!FormatRegistry.Has('integer'))
	FormatRegistry.Set(
		'integer',
		(value) => !!value && Number.isInteger(+value)
	)

if (!FormatRegistry.Has('boolean'))
	FormatRegistry.Set(
		'boolean',
		(value) => value === 'true' || value === 'false'
	)

if (!FormatRegistry.Has('ObjectString'))
	FormatRegistry.Set('ObjectString', (value) => {
		let start = value.charCodeAt(0)

		// If starts with ' ', '\t', '\n', then trim first
		if (start === 9 || start === 10 || start === 32)
			start = value.trimStart().charCodeAt(0)

		if (start !== 123 && start !== 91) return false

		try {
			JSON.parse(value)

			return true
		} catch {
			return false
		}
	})

if (!FormatRegistry.Has('ArrayString'))
	FormatRegistry.Set('ArrayString', (value) => {
		let start = value.charCodeAt(0)

		// If starts with ' ', '\t', '\n', then trim first
		if (start === 9 || start === 10 || start === 32)
			start = value.trimStart().charCodeAt(0)

		if (start !== 123 && start !== 91) return false

		try {
			JSON.parse(value)

			return true
		} catch {
			return false
		}
	})

if (!TypeRegistry.Has('UnionEnum'))
	TypeRegistry.Set<TUnionEnum>('UnionEnum', (schema, value) => {
		return (
			(typeof value === 'number' ||
				typeof value === 'string' ||
				value === null) &&
			schema.enum.includes(value as never)
		)
	})

type NonEmptyArray<T> = [T, ...T[]]

export type TEnumValue = number | string | null

export interface TUnionEnum<
	T extends
		| NonEmptyArray<TEnumValue>
		| Readonly<NonEmptyArray<TEnumValue>> = [TEnumValue]
> extends TSchema {
	type?: 'number' | 'string' | 'null'
	[Kind]: 'UnionEnum'
	static: T[number]
	enum: T
}

export const ElysiaType = {
	Numeric: (property?: NumberOptions) => {
		const schema = Type.Number(property)

		return t
			.Transform(
				t.Union(
					[
						t.String({
							format: 'numeric',
							default: 0
						}),
						t.Number(property)
					],
					property
				)
			)
			.Decode((value) => {
				const number = +value
				if (isNaN(number)) return value

				if (property && !Value.Check(schema, number))
					throw new ValidationError('property', schema, number)

				return number
			})
			.Encode((value) => value) as any as TNumber
	},
	Integer: (property?: IntegerOptions): TInteger => {
		const schema = Type.Integer(property)

		return t
			.Transform(
				t.Union(
					[
						t.String({
							format: 'integer',
							default: 0
						}),
						Type.Integer(property)
					],
					property
				)
			)
			.Decode((value) => {
				const number = +value

				if (!Value.Check(schema, number))
					throw new ValidationError('property', schema, number)

				return number
			})
			.Encode((value) => value) as any as TInteger
	},
	Date: (property?: DateOptions) => {
		const schema = Type.Date(property)
		const _default = property?.default
			? new Date(property.default) // in case the default is an ISO string or milliseconds from epoch
			: undefined

		return t
			.Transform(
				t.Union(
					[
						Type.Date(property),
						t.String({
							format: 'date',
							default: _default?.toISOString()
						}),
						t.String({
							format: 'date-time',
							default: _default?.toISOString()
						}),
						t.Number({ default: _default?.getTime() })
					],
					property
				)
			)
			.Decode((value) => {
				if (typeof value === 'number') {
					const date = new Date(value)

					if (!Value.Check(schema, date))
						throw new ValidationError('property', schema, date)

					return date
				}

				if (value instanceof Date) return value

				const date = new Date(value)

				if (!date || isNaN(date.getTime()))
					throw new ValidationError('property', schema, date)

				if (!Value.Check(schema, date))
					throw new ValidationError('property', schema, date)

				return date
			})
			.Encode((value) => value.toISOString()) as any as TDate
	},
	BooleanString: (property?: SchemaOptions) => {
		const schema = Type.Boolean(property)

		return t
			.Transform(
				t.Union(
					[
						t.Boolean(property),
						t.String({
							format: 'boolean',
							default: false
						})
					],
					property
				)
			)
			.Decode((value) => {
				if (typeof value === 'string') return value === 'true'

				if (value !== undefined && !Value.Check(schema, value))
					throw new ValidationError('property', schema, value)

				return value
			})
			.Encode((value) => value) as any as TBoolean
	},
	ObjectString: <T extends TProperties>(
		properties: T,
		options?: ObjectOptions
	) => {
		const schema = t.Object(properties, options)
		const defaultValue = JSON.stringify(Value.Create(schema))

		let compiler: TypeCheck<TObject<T>>
		try {
			compiler = TypeCompiler.Compile(schema)
		} catch {
			// Nothing
		}

		return t
			.Transform(
				t.Union([
					t.String({
						format: 'ObjectString',
						default: defaultValue
					}),
					schema
				])
			)
			.Decode((value) => {
				if (typeof value === 'string') {
					if (value.charCodeAt(0) !== 123)
						throw new ValidationError('property', schema, value)

					try {
						value = JSON.parse(value as string)
					} catch {
						throw new ValidationError('property', schema, value)
					}

					if (compiler) {
						if (!compiler.Check(value))
							throw new ValidationError('property', schema, value)

						return compiler.Decode(value)
					}

					if (!Value.Check(schema, value))
						throw new ValidationError('property', schema, value)

					return Value.Decode(schema, value)
				}

				return value
			})
			.Encode((value) => {
				if (typeof value === 'string')
					try {
						value = JSON.parse(value as string)
					} catch {
						throw new ValidationError('property', schema, value)
					}

				if (!Value.Check(schema, value))
					throw new ValidationError('property', schema, value)

				return JSON.stringify(value)
			}) as any as TObject<T>
	},
	ArrayString: <T extends TSchema = TString>(
		children: T = t.String() as any,
		options?: ArrayOptions
	) => {
		const schema = t.Array(children, options)

		let compiler: TypeCheck<TArray<T>>
		try {
			compiler = TypeCompiler.Compile(schema)
		} catch {
			// Nothing
		}

		const decode = (value: string, isProperty = false) => {
			if (value.charCodeAt(0) === 91) {
				try {
					value = JSON.parse(value as string)
				} catch {
					throw new ValidationError('property', schema, value)
				}

				if (compiler) {
					if (!compiler.Check(value))
						throw new ValidationError('property', schema, value)

					return compiler.Decode(value)
				}

				if (!Value.Check(schema, value))
					throw new ValidationError('property', schema, value)

				return Value.Decode(schema, value)
			}

			// has , (as used in nuqs)
			if (value.indexOf(',') !== -1) {
				const newValue = value.split(',').map((v) => v.trim())

				if (compiler) {
					if (!compiler.Check(newValue))
						throw new ValidationError('property', schema, value)

					return compiler.Decode(newValue)
				}

				if (!Value.Check(schema, newValue))
					throw new ValidationError('property', schema, newValue)

				return Value.Decode(schema, newValue)
			}

			if (isProperty) return value

			throw new ValidationError('property', schema, value)
		}

		return t
			.Transform(
				t.Union([
					t.String({
						format: 'ArrayString',
						default: options?.default
					}),
					schema
				])
			)
			.Decode((value) => {
				if (Array.isArray(value)) {
					let values = <unknown[]>[]

					for (let i = 0; i < value.length; i++) {
						const v = value[i]
						if (typeof v === 'string') {
							const t = decode(v, true)
							if (Array.isArray(t)) values = values.concat(t)
							else values.push(t)

							continue
						}

						values.push(v)
					}

					return values
				}

				if (typeof value === 'string') return decode(value)

				// Is probably transformed, unable to check schema
				return value
			})
			.Encode((value) => {
				if (typeof value === 'string')
					try {
						value = JSON.parse(value as string)
					} catch {
						throw new ValidationError('property', schema, value)
					}

				if (!Value.Check(schema, value))
					throw new ValidationError('property', schema, value)

				return JSON.stringify(value)
			}) as any as TArray<T>
	},
	File,
	Files: (options: ElysiaTypeOptions.Files = {}) =>
		t
			.Transform(Files(options))
			.Decode((value) => {
				if (Array.isArray(value)) return value
				return [value]
			})
			.Encode((value) => value),
	Nullable: <T extends TSchema>(schema: T, options?: SchemaOptions) =>
		t.Union([schema, t.Null()], options),
	/**
	 * Allow Optional, Nullable and Undefined
	 */
	MaybeEmpty: <T extends TSchema>(schema: T, options?: SchemaOptions) =>
		t.Union([schema, t.Null(), t.Undefined()], options),
	Cookie: <T extends TProperties>(
		properties: T,
		{
			domain,
			expires,
			httpOnly,
			maxAge,
			path,
			priority,
			sameSite,
			secure,
			secrets,
			sign,
			...options
		}: ElysiaTypeOptions.CookieValidatorOption<T> = {}
	) => {
		const v = t.Object(properties, options)

		v.config = {
			domain,
			expires,
			httpOnly,
			maxAge,
			path,
			priority,
			sameSite,
			secure,
			secrets,
			sign
		}

		return v
	},
	// based on https://github.com/elysiajs/elysia/issues/512#issuecomment-1980134955
	UnionEnum: <
		const T extends
			| NonEmptyArray<TEnumValue>
			| Readonly<NonEmptyArray<TEnumValue>>
	>(
		values: T,
		options: SchemaOptions = {}
	) => {
		const type = values.every((value) => typeof value === 'string')
			? { type: 'string' }
			: values.every((value) => typeof value === 'number')
				? { type: 'number' }
				: values.every((value) => value === null)
					? { type: 'null' }
					: {}

		if (values.some((x) => typeof x === 'object' && x !== null))
			throw new Error('This type does not support objects or arrays')

		return {
			// why it need default??
			default: values[0],
			...options,
			[Kind]: 'UnionEnum',
			...type,
			enum: values
		} as any as TUnionEnum<T>
	}
} as const

export type TCookie = (typeof ElysiaType)['Cookie']

declare module '@sinclair/typebox' {
	interface JavaScriptTypeBuilder {
		BooleanString: typeof ElysiaType.BooleanString
		ObjectString: typeof ElysiaType.ObjectString
		ArrayString: typeof ElysiaType.ArrayString
		Numeric: typeof ElysiaType.Numeric
		Integer: typeof ElysiaType.Integer
		File: typeof ElysiaType.File
		Files: typeof ElysiaType.Files
		Nullable: typeof ElysiaType.Nullable
		MaybeEmpty: typeof ElysiaType.MaybeEmpty
		Cookie: typeof ElysiaType.Cookie
		UnionEnum: typeof ElysiaType.UnionEnum
	}

	interface SchemaOptions {
		error?:
			| string
			| boolean
			| number
			| Object
			| ((validation: {
					errors: ValueError[]
					type: string
					validator: TypeCheck<any>
					value: unknown
			  }) => string | boolean | number | Object | void)
	}
}

/**
 * A Boolean string
 *
 * Will be parsed to a Boolean
 */
t.BooleanString = ElysiaType.BooleanString
t.ObjectString = ElysiaType.ObjectString
t.ArrayString = ElysiaType.ArrayString

/**
 * A Numeric string
 *
 * Will be parsed to a Number
 */
t.Numeric = ElysiaType.Numeric
t.Integer = ElysiaType.Integer

t.File = (arg = {}) =>
	ElysiaType.File({
		default: 'File',
		...arg,
		extension: arg?.type,
		type: 'string',
		format: 'binary'
	})

t.Files = (arg = {}) =>
	ElysiaType.Files({
		...arg,
		elysiaMeta: 'Files',
		default: 'Files',
		extension: arg?.type,
		type: 'array',
		items: {
			...arg,
			default: 'Files',
			type: 'string',
			format: 'binary'
		}
	})

// t.Ref = <T extends TSchema>(schema: T) =>
// 	Type.Unsafe<Static<T>>(Type.Ref(schema.$id!))

t.Nullable = (schema) => ElysiaType.Nullable(schema)
t.MaybeEmpty = ElysiaType.MaybeEmpty as any

t.Cookie = ElysiaType.Cookie
t.Date = ElysiaType.Date

t.UnionEnum = ElysiaType.UnionEnum

function getOrSetType<TSchema = unknown, TReturn = unknown>(
	kind: string,
	func: TypeRegistry.TypeRegistryValidationFunction<TSchema>
): TReturn {
	if (!TypeRegistry.Has(kind)) {
		TypeRegistry.Set<TSchema>(kind, func)
	}

	return ((options = {}) =>
		Unsafe({ ...options, [Kind]: kind })) as unknown as TReturn
}

export { t }

export {
	TypeSystemPolicy,
	TypeSystem,
	TypeSystemDuplicateFormat,
	TypeSystemDuplicateTypeKind
} from '@sinclair/typebox/system'
export { TypeRegistry, FormatRegistry } from '@sinclair/typebox'
export { TypeCompiler, TypeCheck } from '@sinclair/typebox/compiler'

// type Template =
// 	| string
// 	| number
// 	| bigint
// 	| boolean
// 	| StringConstructor
// 	| NumberConstructor
// 	| undefined

// type Join<A> = A extends Readonly<[infer First, ...infer Rest]>
// 	? (
// 			First extends Readonly<Template[]>
// 				? First[number]
// 				: First extends StringConstructor
// 				? string
// 				: First extends NumberConstructor
// 				? `${number}`
// 				: First
// 	  ) extends infer A
// 		? Rest extends []
// 			? A extends undefined
// 				? NonNullable<A> | ''
// 				: A
// 			: // @ts-ignore
// 			A extends undefined
// 			? `${NonNullable<A>}${Join<Rest>}` | ''
// 			: // @ts-ignore
// 			  `${A}${Join<Rest>}`
// 		: ''
// 	: ''

// const template = <
// 	const T extends Readonly<(Template | Readonly<Template[]>)[]>
// >(
// 	...p: T
// ): Join<T> => {
// 	return a as any
// }

// const create =
// 	<const T extends string>(t: T): ((t: T) => void) =>
// 	(t) =>
// 		t

// const optional = <
// 	const T extends Readonly<(Template | Readonly<Template[]>)[]>
// >(
// 	...p: T
// ): T | undefined => {
// 	return undefined
// }

// template.optional = optional

// const hi = create(
// 	template(
// 		['seminar', 'millennium'],
// 		':',
// 		['Rio', 'Yuuka', 'Noa', 'Koyuki'],
// 		template.optional(template(',', ['Rio', 'Yuuka', 'Noa', 'Koyuki'])),
// 		template.optional(template(',', ['Rio', 'Yuuka', 'Noa', 'Koyuki'])),
// 		template.optional(template(',', ['Rio', 'Yuuka', 'Noa', 'Koyuki']))
// 	)
// )

// hi(`seminar:Noa,Koyuki,Yuuka`)

// const a = TypeCompiler.Compile(t.String())

// console.log(v.Decode.toString())

// const T = t.Transform(v.schema)
// 	.Decode((value) => new Date(value)) // required: number to Date
// 	.Encode((value) => value.getTime()) // required: Date to number

// const decoded = Value.Decode(T, 0) // const decoded = Date(1970-01-01T00:00:00.000Z)
// const encoded = Value.Encode(T, decoded)
