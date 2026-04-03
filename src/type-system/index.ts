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

type Refines<T> = [refine: (value: T) => boolean, message: string][]

let _StringifiedNumber: Type.TCodec<Type.TRefine<Type.TString>, number>
let _emptyNumeric: Type.TUnion<
	[Type.TNumber, Type.TCodec<Type.TRefine<Type.TString>, number>]
>
function Numeric(property?: TNumberOptions) {
	_StringifiedNumber ??= Type.Decode(
		Type.Refine(
			Type.String(),
			(value) => !isNaN(+value),
			'Expect value to be number'
		),
		(value) => +value
	)

	if (!property)
		return (_emptyNumeric ??= Type.Union([
			Type.Number(),
			_StringifiedNumber
		]))

	const number = Type.Number(property)
	return Type.Union([number, Type.Union([_StringifiedNumber, number])])
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
			'Expect value to be integer'
		),
		(value) => +value
	)

	if (!property)
		return (_emptyInteger ??= Type.Union([
			Type.Integer(),
			_StringifiedInteger
		]))

	const integer = Type.Integer(property)
	return Type.Union([integer, Type.Union([_StringifiedInteger, integer])])
}

let _StringifiedBoolean: Type.TCodec<Type.TRefine<Type.TString>, boolean>
function BooleanString(property?: TSchemaOptions) {
	_StringifiedBoolean ??= Type.Decode(
		Type.Refine(
			Type.String(),
			(value) => value === 'true' || value === 'false',
			'Expect value to be boolean'
		),
		(value) => (value === 'true' ? true : false)
	)

	return Type.Union([Type.Boolean(property), _StringifiedBoolean])
}

function StringifiedObject<T extends TProperties>(
	property: T,
	options?: TObjectOptions
) {
	let parsed: Record<keyof any, unknown>
	const _StringifiedObject = Type.Decode(
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
			'Expect value to be an object'
		),
		(value) => (parsed ??= JSON.parse(value))
	)

	const object = Type.Object(property, options)
	return Type.Union([object, Type.Union([_StringifiedObject, object])])
}

function StringifiedArray<T extends TProperties>(
	property: T,
	options?: TObjectOptions
) {
	let parsed: unknown[]
	const _StringifiedArray = Type.Decode(
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
			'Expect value to be an array'
		),
		(value) => (parsed ??= JSON.parse(value))
	)

	const array = Type.Array(property, options)
	return Type.Union([array, Type.Union([_StringifiedArray, array])])
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
	if (!property)
		return (_EmptyDate ??= Type.Encode(
			Type.Union([
				Type.Refine(
					Type.Unsafe<Date>({ type: 'Date' }),
					(value) => value instanceof Date,
					'Expect value to be Date'
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
		))

	return Type.Encode(
		Type.Union(
			[
				Type.Refine(
					Type.Unsafe<Date>({ type: 'Date' }),
					(value) => value instanceof Date,
					'Expect value to be Date'
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
		(value) => (value instanceof Date ? value.toISOString() : value) as any
	)
}

function Nullable<T extends TSchema>(schema: T, options?: TSchemaOptions) {
	return Type.Union(
		[schema, t.Null()],
		assignOrNew(options, { nullable: true })
	)
}

function MaybeEmpty<T extends TSchema>(schema: T, options?: TSchemaOptions) {
	if (options && !('nullable' in options)) options.nullable = true

	return t.Union(
		[schema, t.Null(), t.Undefined()],
		assignOrNew(options, { nullable: true })
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
		type: 'UnionEnum',
		'~kind': 'UnionEnum',
		enum: values
	}) as any as TUnionEnum<T>

	if (!mixed) schema.type = kind

	return t.Unsafe<TUnionEnum<T>>(schema)
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
			'Expect value to be instance of Blob'
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

	return Refines(Type.Unsafe<File>({ type: 'File' }), refines)
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

	return Refines(
		Type.Decode(
			Type.Union([
				Type.Unsafe<File[]>({ ...options, type: 'Files' }),
				Type.Array(Type.Unsafe<File>({ ...options, type: 'File' }))
			]),
			(value) => (Array.isArray(value) ? value : [value])
		),
		refines
	)
}

function Form<T extends TProperties>(property: T, options?: TObjectOptions) {
	return Type.Union([
		Type.Decode(
			Type.Refine(
				Type.Unsafe<
					FormData & { '~ely-form': Record<keyof any, unknown> }
				>({ type: 'FormData' }),
				(value) => '~ely-form' in value,
				'Expect value to be instance of Elysia.form'
			),
			(value) => value['~ely-form']
		),
		Type.Object(property, options)
	])
}

function NoValidate<T extends TSchema>(v: T, enabled = true) {
	// @ts-ignore
	if (enabled) v.noValidate = true

	return v
}

let _emptyArrayBuffer: Type.TRefine<Type.TUnsafe<ArrayBuffer>>
function ArrayBufferType(property?: ArrayBufferOptions) {
	if (!property)
		return (_emptyArrayBuffer ??= Type.Refine(
			Type.Unsafe<ArrayBuffer>({ type: 'ArrayBuffer' }),
			(value) => value instanceof ArrayBuffer,
			'Expect value to be ArrayBuffer'
		))

	const refines: Refines<ArrayBuffer> = [
		[
			(value) => value instanceof ArrayBuffer,
			'Expect value to be ArrayBuffer'
		]
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

	return Refines(
		Type.Unsafe<ArrayBuffer>(
			assignOrNew(property, { type: 'ArrayBuffer' })
		),
		refines
	)
}

let _emptyUint8Array: Type.TRefine<Type.TUnsafe<Uint8Array>>
function Uint8ArrayType(property?: ArrayBufferOptions) {
	if (!property)
		return (_emptyUint8Array ??= Type.Refine(
			Type.Unsafe<Uint8Array>({ type: 'Uint8Array' }),
			(value) => value instanceof Uint8Array,
			'Expect value to be Uint8Array'
		))

	const refines: Refines<Uint8Array> = [
		[
			(value) => value instanceof Uint8Array,
			'Expect value to be Uint8Array'
		]
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

	return Refines(
		Type.Unsafe<Uint8Array>(assignOrNew(property, { type: 'Uint8Array' })),
		refines
	)
}

export const t = Object.assign({}, Type, {
	Numeric,
	Integer,
	BooleanString,
	StringifiedObject,
	StringifiedArray,
	Date: DateType,
	Nullable,
	MaybeEmpty,
	UnionEnum,
	NoValidate,
	File,
	Files,
	Form,
	ArrayBuffer: ArrayBufferType,
	Uint8Array: Uint8ArrayType
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
