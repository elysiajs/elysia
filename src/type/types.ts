import type { TObjectOptions, TSchemaOptions } from 'typebox'
import type { TLocalizedValidationError } from 'typebox/error'

import type { ELYSIA_TYPES } from './constants'
import type { CookieOptions } from '../cookie'

type MaybeArray<T> = T | T[]

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

export interface FileOptions extends TSchemaOptions {
	type?: MaybeArray<FileType>
	/**
	 * Each file must be at least the specified size.
	 *
	 * @example '600k' (600 kilobytes), '3m' (3 megabytes)
	 */
	minSize?: FileUnit
	/**
	 * Each file must be less than or equal to the specified size.
	 *
	 * @example '3m' (3 megabytes), '600k' (600 kilobytes)
	 */
	maxSize?: FileUnit
}

export interface FilesOptions extends FileOptions {
	minItems?: number
	maxItems?: number
}

export interface CookieValidatorOptions<T extends Object = {}>
	extends TObjectOptions,
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
	 * Specified cookie name to be signed globally.
	 * Pass `true` to sign all cookies.
	 */
	sign?: true | Readonly<(keyof T | (string & {}))[]>
}

export type NonEmptyArray<T> = [T, ...T[]]
export type TEnumValue = number | string | null

export interface TUnionEnum<
	T extends
		| NonEmptyArray<TEnumValue>
		| Readonly<NonEmptyArray<TEnumValue>> = [TEnumValue]
> {
	'~kind': 'UnionEnum'
	type?: 'number' | 'string' | 'null'
	static: T[number]
	enum: T
}

export interface DateOptions extends TSchemaOptions {
	/** The exclusive maximum timestamp value */
	exclusiveMaximumTimestamp?: number
	/** The exclusive minimum timestamp value */
	exclusiveMinimumTimestamp?: number
	/** The maximum timestamp value */
	maximumTimestamp?: number
	/** The minimum timestamp value */
	minimumTimestamp?: number
	/** The multiple of timestamp value */
	multipleOfTimestamp?: number
	default?: string | Date | number
}

export interface ArrayBufferOptions extends TSchemaOptions {
	maxByteLength?: number
	minByteLength?: number
}

/**
 * !important
 * @see https://github.com/elysiajs/elysia/pull/1613
 *
 * Augment this interface to extend allowed values for SchemaOptions['error'].
 * Defining custom string templates will add autocomplete while allowing any arbitrary string, number, etc.
 *
 * The names of keys only used to map to the values, unless you globally augment a specific key.
 *
 * ```ts
 * declare module 'elysia/type-system/types' {
 *   interface ElysiaTypeCustomErrors {
 *     myPlugin: 'my.plugin.error' | `my.plugin.${string}`
 *   }
 * }
 *
 * const schema = t.String({ error: 'my.plugin.hello' })
 * ```
 */
export interface ElysiaTypeCustomErrors {
	/**
	 * The default error types that the library supports.
	 *
	 * `string & {}` `number & {}` are used to allow string templates and numbers respectively.
	 */
	default:
		| (string & {})
		| boolean
		| (number & {})
		| ElysiaTypeCustomErrorCallback
}

export type ElysiaTypeCustomError =
	ElysiaTypeCustomErrors[keyof ElysiaTypeCustomErrors]

/**
 * The argument shape passed to a custom-error callback.
 *
 * The runtime redacts schema-revealing detail in production (and passes only a
 * partial object), so every field beyond `type`/`on` is optional and may be
 * `undefined` depending on the environment and validation-detail policy.
 */
export type ElysiaTypeCustomErrorCallback = (error: {
	/**
	 * Error type
	 */
	type: 'validation'
	/**
	 * Where the error was found
	 */
	on: 'body' | 'query' | 'params' | 'headers' | 'cookie' | 'response'
	/**
	 * Value that was found at the failing location
	 * (omitted / `undefined` on production)
	 */
	found?: unknown
	/**
	 * Value that caused the error
	 * (omitted on production)
	 */
	value?: unknown
	/**
	 * Property that caused the error
	 * (omitted on production)
	 */
	property?: string
	/**
	 * Error message
	 * (omitted on production)
	 */
	message?: string
	/**
	 * Expected value
	 * (omitted on production)
	 */
	expected?: unknown
	/**
	 * Array of validation errors
	 * (omitted on production)
	 */
	errors?: TLocalizedValidationError[]
}) => unknown

type BaseSchemaRecord = Record<string, BaseSchema>

export interface BaseSchema {
	// Some typebox node types (TCodec/TUnsafe/TRefine)
	// don't declare `~kind` statically"
	'~kind'?: string
	'~elyTyp'?: ELYSIA_TYPES[keyof ELYSIA_TYPES]
	$id?: string
	id?: string
	type?: string
	$schema?: string
	const?: unknown[]
	// title?: string
	// description?: string
	// multipleOf?: number
	// maximum?: number
	// exclusiveMaximum?: boolean
	// minimum?: number
	// exclusiveMinimum?: boolean
	// maxLength?: number
	// minLength?: number
	// pattern?: string
	additionalItems?: boolean | BaseSchema
	items?: BaseSchema | BaseSchema[]
	// maxItems?: number
	// minItems?: number
	// uniqueItems?: boolean
	// maxProperties?: number
	// minProperties?: number
	required?: string[]
	additionalProperties?: boolean | BaseSchema
	definitions?: BaseSchemaRecord
	properties?: BaseSchemaRecord
	patternProperties?: BaseSchemaRecord
	dependencies?: BaseSchemaRecord
	enum?: unknown[]
	allOf?: BaseSchema[]
	anyOf?: BaseSchema[]
	oneOf?: BaseSchema[]
	not?: BaseSchema
	$ref?: string
	$defs?: BaseSchemaRecord
}

export interface StandardJSONSchemaV1Like {
	readonly '~standard': {
		readonly jsonSchema: {
			readonly input: StandardJSONSchemaV1LikeIO
			readonly output: StandardJSONSchemaV1LikeIO
		}
	}
}

// Standard Schema reduce to bare minimum to save inference time
export interface StandardSchemaV1Like<
	in out Input = unknown,
	in out Output = Input
> {
	readonly '~standard': {
		readonly types?:
			| {
					readonly input: Input
					readonly output: Output
			  }
			| undefined
	}
}

type StandardJSONSchemaV1LikeIO = (params: {
	readonly target: string
}) => Record<string, unknown>

declare module 'typebox' {
	interface TSchemaOptions {
		error?: ElysiaTypeCustomError
	}
}

export type TypeBoxSchema =
	| { '~kind': string }
	| { '~unsafe': unknown }
	| { '~refine': unknown }
	| { '~codec': unknown }

export type AnySchema = TypeBoxSchema | StandardSchemaV1Like
