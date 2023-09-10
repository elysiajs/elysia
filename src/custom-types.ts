import { TypeSystem } from '@sinclair/typebox/system'
import {
	Type,
	type SchemaOptions,
	type NumericOptions,
	type TNull,
	type TUnion,
	type TSchema,
	type TUndefined
} from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'

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

export const ElysiaType = {
	// Numeric type is for type reference only since it's aliased to t.Number
	Numeric: TypeSystem.Type<number, NumericOptions<number>>(
		'Numeric',
		{} as any
	),
	File: TypeSystem.Type<File, ElysiaTypeOptions.File>('File', validateFile),
	Files: TypeSystem.Type<File[], ElysiaTypeOptions.Files>(
		'Files',
		(options, value) => {
			if (!Array.isArray(value)) return validateFile(options, value)

			if (options.minItems && value.length < options.minItems)
				return false

			if (options.maxItems && value.length > options.maxItems)
				return false

			for (let i = 0; i < value.length; i++)
				if (!validateFile(options, value[i])) return false

			return true
		}
	),
	Nullable: <T extends TSchema>(schema: T): TUnion<[T, TNull]> =>
		({ ...schema, nullable: true } as any),
	MaybeEmpty: <T extends TSchema>(schema: T): TUnion<[T, TUndefined]> =>
		Type.Union([Type.Undefined(), schema]) as any,
} as const

declare module '@sinclair/typebox' {
	interface TypeBuilder {
		Numeric: typeof ElysiaType.Numeric
		// @ts-ignore
		File: typeof ElysiaType.File
		// @ts-ignore
		Files: typeof ElysiaType.Files
		Nullable: typeof ElysiaType.Nullable
		MaybeEmpty: typeof ElysiaType.MaybeEmpty
		URLEncoded: (typeof Type)['Object']
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

/**
 * A Numeric string
 *
 * Will be parse to Number
 */
Type.Numeric = (properties) => {
	return Type.Number({
		...properties,
		elysiaMeta: 'Numeric'
	}) as any
}

Type.URLEncoded = (property, options) =>
	Type.Object(property, {
		...options,
		elysiaMeta: 'URLEncoded'
	})

Type.File = (arg = {}) =>
	ElysiaType.File({
		elysiaMeta: 'File',
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

export { Type as t }
