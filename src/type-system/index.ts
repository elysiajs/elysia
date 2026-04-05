import { Type } from 'typebox'
import type {
	TSchemaOptions,
	TEnumValue,
	TProperties,
	TSchema,
	TNumberOptions,
	TObjectOptions,
	Static
} from 'typebox'

import type {
	FilesOptions,
	NonEmptyArray,
	TUnionEnum,
	DateOptions,
	ArrayBufferOptions,
	FileOptions,
	FileUnit,
	FileType
} from './types'

import { ElysiaFile } from '../universal/file'
import { isEmpty, type ElysiaFormData } from '../utils'
import type { StandardJSONSchemaV1Like } from '../types'

function assignOrNew<
	T extends Record<keyof any, unknown> | undefined,
	R extends Record<keyof any, unknown>
>(target: T, source: R): undefined extends T ? R : T & R {
	if (target) return Object.assign(target, source)

	return source as unknown as T & R
}

function Refines<T extends TSchema>(schema: T, refines: Refines<Static<T>>) {
	for (const [refine, message] of refines)
		schema = Type.Refine(schema, refine, message)

	return schema
}

// Start at 1 to prevent falsy value check
export const ELYSIA_TYPES = {
	Numeric: 1,
	Integer: 2,
	BooleanString: 3,
	ObjectString: 4,
	ArrayString: 5,
	Date: 6,
	Nullable: 7,
	MaybeEmpty: 8,
	UnionEnum: 9,
	File: 10,
	Files: 11,
	Form: 12,
	ArrayBuffer: 13,
	Uint8Array: 14,
	NoValidate: 15
} as const

export type ELYSIA_TYPES = typeof ELYSIA_TYPES

function elyType<T extends TSchema>(
	name: ELYSIA_TYPES[keyof ELYSIA_TYPES],
	schema: T
): T {
	// @ts-expect-error
	schema['~elyTyp'] = name
	return schema
}

type Refines<T> = [refine: (value: T) => boolean, message: string][]

let _StringifiedNumber: Type.TCodec<Type.TRefine<Type.TString>, number>
let _emptyNumeric: Type.TUnion<
	[Type.TNumber, Type.TCodec<Type.TRefine<Type.TString>, number>]
>
function Numeric(property?: TNumberOptions) {
	_StringifiedNumber ??= Type.Decode(
		Type.Refine(Type.String(), (value) => !isNaN(+value), 'must be number'),
		(value) => +value
	)

	if (isEmpty(property))
		return (_emptyNumeric ??= elyType(
			ELYSIA_TYPES.Numeric,
			Type.Union([Type.Number(), _StringifiedNumber])
		))

	const number = Type.Number(property)
	return elyType(
		ELYSIA_TYPES.Numeric,
		Type.Union([number, Type.Union([_StringifiedNumber, number])])
	)
}

let _StringifiedInteger: Type.TCodec<Type.TRefine<Type.TString>, number>
let _emptyInteger: Type.TUnion<
	[Type.TInteger, Type.TCodec<Type.TRefine<Type.TString>, number>]
>
function Integer(property?: TNumberOptions) {
	_StringifiedInteger = Type.Decode(
		Type.Refine(
			Type.String(),
			(value) => !isNaN(+value) && Number.isInteger(+value),
			'must be integer'
		),
		(value) => +value
	)

	if (isEmpty(property))
		return (_emptyInteger ??= elyType(
			ELYSIA_TYPES.Integer,
			Type.Union([Type.Integer(), _StringifiedInteger])
		))

	const integer = Type.Integer(property)
	return elyType(
		ELYSIA_TYPES.Integer,
		Type.Union([integer, Type.Union([_StringifiedInteger, integer])])
	)
}

let _StringifiedBoolean: Type.TCodec<Type.TRefine<Type.TString>, boolean>
let _emptyBoolean: Type.TUnion<
	[Type.TCodec<Type.TRefine<Type.TString>, boolean>, Type.TBoolean]
>
function BooleanString(property?: TSchemaOptions) {
	_StringifiedBoolean ??= Type.Decode(
		Type.Refine(
			Type.String(),
			(value) => value === 'true' || value === 'false',
			'must be boolean'
		),
		(value) => (value === 'true' ? true : false)
	)

	if (isEmpty(property))
		return (_emptyBoolean ??= elyType(
			ELYSIA_TYPES.BooleanString,
			Type.Union([_StringifiedBoolean, Type.Boolean()])
		))

	return elyType(
		ELYSIA_TYPES.BooleanString,
		Type.Union([Type.Boolean(property), _StringifiedBoolean])
	)
}

function ObjectString<T extends TProperties>(
	property: T,
	options?: TObjectOptions
) {
	let parsed: Record<keyof any, unknown>
	const _ObjectString = Type.Decode(
		Type.Refine(
			Type.String(),
			(value) => {
				if (
					(value.charCodeAt(0) !== 123 &&
						value.charCodeAt(value.length - 1) !== 125) ||
					(value.charCodeAt(0) !== 91 &&
						value.charCodeAt(value.length - 1) !== 93)
				)
					return false

				try {
					parsed = JSON.parse(value)

					return true
				} catch {
					return false
				}
			},
			'must be an object'
		),
		(value) => (parsed ??= JSON.parse(value))
	)

	const object = Type.Object(property, options)
	return elyType(
		ELYSIA_TYPES.ObjectString,
		Type.Union([object, Type.Union([_ObjectString, object])])
	)
}

function ArrayString<T extends TProperties>(
	property: T,
	options?: TObjectOptions
) {
	let parsed: unknown[]
	const _ArrayString = Type.Decode(
		Type.Refine(
			Type.String(),
			(value) => {
				if (
					value.charCodeAt(0) !== 91 &&
					value.charCodeAt(value.length - 1) !== 93
				)
					return false

				try {
					parsed = JSON.parse(value)

					return true
				} catch {
					return false
				}
			},
			'must be an array'
		),
		(value) => (parsed ??= JSON.parse(value))
	)

	const array = Type.Array(property, options)
	return elyType(
		ELYSIA_TYPES.ArrayString,
		Type.Union([array, Type.Union([_ArrayString, array])])
	)
}

let _EmptyDate: Type.TCodec<
	Type.TUnion<
		[
			Type.TRefine<Type.TUnsafe<Date>>,
			Type.TCodec<Type.TUnion<[Type.TString, Type.TString]>, Date>
		]
	>,
	unknown
>
function DateType(property?: DateOptions) {
	if (isEmpty(property))
		return (_EmptyDate ??= elyType(
			ELYSIA_TYPES.Date,
			Type.Encode(
				Type.Union([
					Type.Refine(
						Type.Unsafe<Date>({ '~kind': 'Date' }),
						(value) => value instanceof Date,
						'must be Date'
					),
					Type.Decode(
						Type.Union([
							Type.String({
								format: 'date',
								default: new Date(0).toISOString()
							}),
							Type.String({
								format: new Date(0).toISOString()
							})
						]),
						(value) => new Date(value)
					)
				]),
				(value) =>
					(value instanceof Date ? value.toISOString() : value) as any
			)
		))

	return elyType(
		ELYSIA_TYPES.Date,
		Type.Encode(
			Type.Union(
				[
					Type.Refine(
						Type.Unsafe<Date>({ '~kind': 'Date' }),
						(value) => value instanceof Date,
						'must be Date'
					),
					Type.Decode(
						Type.Union([
							Type.String({
								format: 'date',
								default: new Date(0).toISOString()
							}),
							Type.String({
								format: new Date(0).toISOString()
							})
						]),
						(value) => new Date(value)
					)
				],
				property
			),
			(value) =>
				(value instanceof Date ? value.toISOString() : value) as any
		)
	)
}

const Nullable = <T extends TSchema>(schema: T, options?: TSchemaOptions) =>
	elyType(
		ELYSIA_TYPES.Nullable,
		Type.Union([schema, t.Null()], assignOrNew(options, { nullable: true }))
	)

function MaybeEmpty<T extends TSchema>(schema: T, options?: TSchemaOptions) {
	if (options && !('nullable' in options)) options.nullable = true

	return elyType(
		ELYSIA_TYPES.MaybeEmpty,
		t.Union(
			[schema, t.Null(), t.Undefined()],
			assignOrNew(options, { nullable: true })
		)
	)
}

function UnionEnum<
	const T extends
		| NonEmptyArray<TEnumValue>
		| Readonly<NonEmptyArray<TEnumValue>>
>(values: T, options?: TSchemaOptions) {
	let kind: 'string' | 'number' | 'null' | undefined
	let mixed = false

	for (const v of values) {
		if (typeof v === 'object' && v !== null)
			throw new Error('This type does not support objects or arrays')

		const type = v === null ? 'null' : typeof v

		if (!kind) kind = type as any
		else if (kind !== type) mixed = true
	}

	const schema = assignOrNew(options, {
		default: values[0],
		'~kind': 'UnionEnum',
		enum: values
	}) as any as TUnionEnum<T>

	if (!mixed) schema.type = kind

	return elyType(ELYSIA_TYPES.UnionEnum, t.Unsafe<TUnionEnum<T>>(schema))
}

function _checkFileExtension(type: string, extension: string) {
	if (type.startsWith(extension)) return true

	return (
		extension.charCodeAt(extension.length - 1) === 42 &&
		extension.charCodeAt(extension.length - 2) === 47 &&
		type.startsWith(extension.slice(0, -1))
	)
}

function _parseFileUnit(size: FileUnit) {
	if (typeof size !== 'string') return size

	switch (size.slice(-1)) {
		case 'k':
			return +size.slice(0, size.length - 1) * 1024

		case 'm':
			return +size.slice(0, size.length - 1) * 1048576

		default:
			return +size
	}
}

function File(options?: FileOptions) {
	const refines: Refines<File> = [
		[
			// @ts-expect-error
			(value) => value instanceof Blob || value instanceof ElysiaFile,
			'must be instance of Blob'
		]
	]

	if (options) {
		if (options.minSize) {
			const minSize = _parseFileUnit(options.minSize!)

			refines.push([
				(value) => value.size > minSize,
				`Expect file size to be more than ${options.minSize}`
			])
		}

		if (options.maxSize) {
			const maxSize = _parseFileUnit(options.maxSize!)

			refines.push([
				(value) => value.size < maxSize,
				`Expect file size to be less than ${options.maxSize}`
			])
		}

		if (options.type) {
			if (typeof options.type === 'string')
				refines.push([
					(value) =>
						_checkFileExtension(
							value.type,
							options.type as FileType
						),
					`Expect file type to be ${options.type}`
				])
			else
				refines.push([
					(value) => {
						for (let i = 0; i < options.type!.length; i++)
							if (
								_checkFileExtension(
									value.type,
									options.type![i]
								)
							)
								return true

						return false
					},
					`Expect file type to be one of ${options.type.join(', ')}`
				])
		}
	}

	return elyType(
		ELYSIA_TYPES.File,
		Refines(Type.Unsafe<File>({ '~kind': 'File' }), refines)
	)
}

function Files(options?: FilesOptions) {
	const refines: Refines<File[]> = []

	if (options) {
		if (options.minItems && options.minItems > 1)
			refines.push([
				(value) =>
					Array.isArray(value) && value.length >= options.minItems!,
				`Expect at least ${options.minItems} files`
			])

		if (options.maxItems)
			refines.push([
				(value) =>
					Array.isArray(value) && value.length <= options.maxItems!,
				`Expect less than ${options.maxItems} files`
			])
	}

	return elyType(
		ELYSIA_TYPES.Files,
		Refines(
			Type.Decode(
				Type.Union([
					Type.Unsafe<File[]>({ ...options, '~kind': 'Files' }),
					Type.Array(
						Type.Unsafe<File>({ ...options, '~kind': 'File' })
					)
				]),
				(value) => (Array.isArray(value) ? value : [value])
			),
			refines
		)
	)
}

const Form = <T extends TProperties>(property: T, options?: TObjectOptions) =>
	elyType(
		ELYSIA_TYPES.Form,
		Type.Union([
			Type.Decode(
				Type.Refine(
					Type.Unsafe<ElysiaFormData<T>>({ '~kind': 'FormData' }),
					(value) => '~ely-form' in value,
					'must be instance of Elysia.form'
				),
				(value) => value['~ely-form']
			),
			Type.Object(property, options)
		])
	)

function NoValidate<T extends TSchema>(v: T, enabled = true) {
	// @ts-ignore
	if (enabled) v.noValidate = true

	return elyType(ELYSIA_TYPES.NoValidate, v)
}

let _emptyArrayBuffer: Type.TRefine<Type.TUnsafe<ArrayBuffer>>
function ArrayBufferType(property?: ArrayBufferOptions) {
	if (isEmpty(property))
		return (_emptyArrayBuffer ??= elyType(
			ELYSIA_TYPES.ArrayBuffer,
			Type.Refine(
				Type.Unsafe<ArrayBuffer>({ '~kind': 'ArrayBuffer' }),
				(value) => value instanceof ArrayBuffer,
				'must be ArrayBuffer'
			)
		))

	const refines: Refines<ArrayBuffer> = [
		[(value) => value instanceof ArrayBuffer, 'must be ArrayBuffer']
	]

	if (property.minByteLength)
		refines.push([
			(value) => value.byteLength > property.minByteLength!,
			`Expect byte to be more than ${property.minByteLength}`
		])

	if (property.maxByteLength)
		refines.push([
			(value) => value.byteLength < property.maxByteLength!,
			`Expect byte to be less than ${property.maxByteLength}`
		])

	return elyType(
		ELYSIA_TYPES.ArrayBuffer,
		Refines(
			Type.Unsafe<ArrayBuffer>(
				assignOrNew(property, { '~kind': 'ArrayBuffer' })
			),
			refines
		)
	)
}

let _emptyUint8Array: Type.TRefine<Type.TUnsafe<Uint8Array>>
function Uint8ArrayType(property?: ArrayBufferOptions) {
	if (isEmpty(property))
		return (_emptyUint8Array ??= elyType(
			ELYSIA_TYPES.Uint8Array,
			Type.Refine(
				Type.Unsafe<Uint8Array>({ '~kind': 'Uint8Array' }),
				(value) => value instanceof Uint8Array,
				'must be Uint8Array'
			)
		))

	const refines: Refines<Uint8Array> = [
		[(value) => value instanceof Uint8Array, 'must be Uint8Array']
	]

	if (property.minByteLength) {
		refines.push([
			(value) => value.byteLength >= property.minByteLength!,
			`Expect byte to be more than ${property.minByteLength}`
		])
	}

	if (property.maxByteLength)
		refines.push([
			(value) => value.byteLength <= property.maxByteLength!,
			`Expect byte to be less than ${property.maxByteLength}`
		])

	return elyType(
		ELYSIA_TYPES.Uint8Array,
		Refines(
			Type.Unsafe<Uint8Array>(
				assignOrNew(property, { '~kind': 'Uint8Array' })
			),
			refines
		)
	)
}

function Accelerate(schema: StandardJSONSchemaV1Like) {
	const jsonSchema =
		// @ts-expect-error
		schema.toJSONSchema?.() ??
		// @ts-expect-error
		schema.toJsonSchema?.() ??
		schema['~standard'].jsonSchema.input({
			target: 'draft-2020-12'
		})

	jsonSchema['~elyAcl'] = true

	return jsonSchema
}

export const t = Object.assign({}, Type, {
	Numeric,
	Integer,
	BooleanString,
	ObjectString,
	ArrayString,
	Date: DateType,
	Nullable,
	MaybeEmpty,
	UnionEnum,
	NoValidate,
	File,
	Files,
	Form,
	ArrayBuffer: ArrayBufferType,
	Uint8Array: Uint8ArrayType,
	Accelerate
})

// Cookie: <T extends TProperties>(
// 	property: T,
// 	{
// 		domain,
// 		expires,
// 		httpOnly,
// 		maxAge,
// 		path,
// 		priority,
// 		sameSite,
// 		secure,
// 		secrets,
// 		sign,
// 		...options
// 	}: CookieValidatorOptions<T> = {}
// ) => {
// 	const v = t.Object(properties, options)
// 	v.config = {
// 		domain,
// 		expires,
// 		httpOnly,
// 		maxAge,
// 		path,
// 		priority,
// 		sameSite,
// 		secure,
// 		secrets,
// 		sign
// 	}
// 	return v
// },

export { System } from 'typebox/system'
export type { BaseSchema } from './types'
