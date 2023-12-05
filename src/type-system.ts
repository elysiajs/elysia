import { TypeSystem } from '@sinclair/typebox/system'
import {
	Type,
	type SchemaOptions,
	type NumericOptions,
	type TNull,
	type TUnion,
	type TSchema,
	type TUndefined,
	TProperties,
	ObjectOptions,
	TObject,
	TNumber,
	FormatRegistry
} from '@sinclair/typebox'
import { type TypeCheck } from '@sinclair/typebox/compiler'
import { CookieOptions } from './cookie'
import { Value } from '@sinclair/typebox/value'
import { ValidationError } from './error'

try {
	TypeSystem.Format('email', (value) =>
		/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
			value
		)
	)

	TypeSystem.Format('uuid', (value) =>
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value
		)
	)

	TypeSystem.Format(
		'date',
		(value) => !Number.isNaN(new Date(value).getTime())
	)

	TypeSystem.Format(
		'date-time',
		(value) => !Number.isNaN(new Date(value).getTime())
	)

	TypeSystem.Format('uri', (value) =>
		/(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/gi.test(
			value
		)
	)
} catch (error) {
	// Not empty
}

type MaybeArray<T> = T | T[]

export namespace ElysiaTypeOptions {
	export type Numeric = NumericOptions<number>

	export type FileUnit = number | `${number}${'k' | 'm'}`

	export interface File extends SchemaOptions {
		type?: MaybeArray<
			| (string & {})
			| 'image'
			| 'image/jpeg'
			| 'image/png'
			| 'image/gif'
			| 'image/tiff'
			| 'image/x-icon'
			| 'image/svg'
			| 'image/webp'
			| 'image/avif'
			| 'audio'
			| 'audio/mpeg'
			| 'audio/x-ms-wma'
			| 'audio/vnd.rn-realaudio'
			| 'audio/x-wav'
			| 'video'
			| 'video/mpeg'
			| 'video/mp4'
			| 'video/quicktime'
			| 'video/x-ms-wmv'
			| 'video/x-msvideo'
			| 'video/x-flv'
			| 'video/webm'
			| 'text'
			| 'text/css'
			| 'text/csv'
			| 'text/html'
			| 'text/javascript'
			| 'text/plain'
			| 'text/xml'
			| 'application'
			| 'application/ogg'
			| 'application/pdf'
			| 'application/xhtml'
			| 'application/html'
			| 'application/json'
			| 'application/ld+json'
			| 'application/xml'
			| 'application/zip'
		>
		minSize?: FileUnit
		maxSize?: FileUnit
	}

	export interface Files extends File {
		minItems?: number
		maxItems?: number
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

const validateFile = (options: ElysiaTypeOptions.File, value: any) => {
	if (!(value instanceof Blob)) return false

	if (options.minSize && value.size < parseFileUnit(options.minSize))
		return false

	if (options.maxSize && value.size > parseFileUnit(options.maxSize))
		return false

	if (options.extension)
		if (typeof options.extension === 'string') {
			if (!value.type.startsWith(options.extension)) return false
		} else {
			for (let i = 0; i < options.extension.length; i++)
				if (value.type.startsWith(options.extension[i])) return true

			return false
		}

	return true
}

const Files = TypeSystem.Type<File[], ElysiaTypeOptions.Files>(
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

FormatRegistry.Set('numeric', (value) => !!value && !isNaN(+value))
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

export const ElysiaType = {
	Numeric: (property?: NumericOptions<number>) => {
		const schema = Type.Number(property)

		return Type.Transform(
			Type.Union([
				Type.String({
					format: 'numeric',
					default: 0
				}),
				schema
			])
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
	ObjectString: <T extends TProperties>(
		properties: T,
		options?: ObjectOptions
	) =>
		Type.Transform(
			Type.Union([
				Type.String({
					format: 'ObjectString',
					default: ''
				}),
				Type.Object(properties, options)
			])
		)
			.Decode((value) => {
				if (typeof value === 'string')
					try {
						return JSON.parse(value as string)
					} catch {
						return value
					}

				return value
			})
			.Encode((value) => JSON.stringify(value)) as any as TObject<T>,
	File: TypeSystem.Type<File, ElysiaTypeOptions.File>('File', validateFile),
	Files: (options: ElysiaTypeOptions.Files = {}) =>
		Type.Transform(Files(options))
			.Decode((value) => {
				if (Array.isArray(value)) return value
				return [value]
			})
			.Encode((value) => value),
	Nullable: <T extends TSchema>(schema: T): TUnion<[T, TNull]> =>
		Type.Union([Type.Null(), schema]) as any,
	/**
	 * Allow Optional, Nullable and Undefined
	 */
	MaybeEmpty: <T extends TSchema>(schema: T): TUnion<[T, TUndefined]> =>
		Type.Union([Type.Null(), Type.Undefined(), schema]) as any,
	Cookie: <T extends TProperties>(
		properties: T,
		options?: ObjectOptions &
			CookieOptions & {
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
	): TObject<T> => Type.Object(properties, options)
} as const

export type TCookie = (typeof ElysiaType)['Cookie']

declare module '@sinclair/typebox' {
	interface TypeBuilder {
		ObjectString: typeof ElysiaType.ObjectString
		// @ts-ignore
		Numeric: typeof ElysiaType.Numeric
		// @ts-ignore
		File: typeof ElysiaType.File
		// @ts-ignore
		Files: typeof ElysiaType.Files
		Nullable: typeof ElysiaType.Nullable
		MaybeEmpty: typeof ElysiaType.MaybeEmpty
		Cookie: typeof ElysiaType.Cookie
	}

	interface SchemaOptions {
		error?:
			| string
			| ((
					type: string,
					validator: TypeCheck<any>,
					value: unknown
			  ) => string | void)
	}
}

Type.ObjectString = ElysiaType.ObjectString

/**
 * A Numeric string
 *
 * Will be parse to Number
 */
Type.Numeric = ElysiaType.Numeric

Type.File = (arg = {}) =>
	ElysiaType.File({
		default: 'File',
		...arg,
		extension: arg?.type,
		type: 'string',
		format: 'binary'
	})

Type.Files = (arg = {}) =>
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

Type.Nullable = (schema) => ElysiaType.Nullable(schema)
Type.MaybeEmpty = ElysiaType.MaybeEmpty

Type.Cookie = ElysiaType.Cookie

export { Type as t }

export * from '@sinclair/typebox/system'
export * from '@sinclair/typebox/compiler'

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

// const a = TypeCompiler.Compile(Type.String())

// console.log(v.Decode.toString())

// const T = Type.Transform(v.schema)
// 	.Decode((value) => new Date(value)) // required: number to Date
// 	.Encode((value) => value.getTime()) // required: Date to number

// const decoded = Value.Decode(T, 0) // const decoded = Date(1970-01-01T00:00:00.000Z)
// const encoded = Value.Encode(T, decoded)
