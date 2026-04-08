import { Type } from 'typebox'
import type {
	Static,
	TSchemaOptions,
	TEnumValue,
	TProperties,
	TSchema,
	TNumberOptions,
	TObjectOptions,
	StaticDecode,
	TNumber,
	TInteger,
	TBoolean,
	TStringOptions,
	TString,
	TObject,
	TArray,
	TOptional
} from 'typebox'

import { checksum, isEmpty, IsTuple, type ElysiaFormData } from '../utils'
import { ElysiaFile } from '../universal/file'
import type {
	FilesOptions,
	NonEmptyArray,
	TUnionEnum,
	DateOptions,
	ArrayBufferOptions,
	FileOptions,
	FileUnit,
	FileType,
	BaseSchema
} from './types'
import type { Prettify, StandardJSONSchemaV1Like } from '../types'

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
	try {
		// @ts-expect-error
		schema['~elyTyp'] = name
		return schema
	} catch {
		if ('~elyTyp' in schema) return schema

		return Object.assign({}, schema, { '~elyTyp': name })
	}
}

export const primitiveElysiaTypes = new Set([
	ELYSIA_TYPES.Numeric,
	ELYSIA_TYPES.Integer,
	ELYSIA_TYPES.BooleanString,
	ELYSIA_TYPES.Date,
	ELYSIA_TYPES.File,
	ELYSIA_TYPES.Files,
	ELYSIA_TYPES.ArrayBuffer,
	ELYSIA_TYPES.Uint8Array
])

function assignOrNew<
	T extends Record<keyof any, unknown> | undefined,
	R extends Record<keyof any, unknown>
>(target: T, source: R): undefined extends T ? R : T & R {
	if (target) return Object.assign(target, source)

	return source as unknown as T & R
}

const sharedReferences = new Set<Map<number, unknown>>()

function createPrimitiveReference<
	const P extends Record<keyof any, unknown>,
	const T extends TSchema,
	const B extends TSchema
>(primitive: B) {
	let shared: T

	return (
		property: P,
		createType: (property: P, primitive: B) => T,
		patch: (schema: T, property: P, primitive: B) => T
	): Readonly<T> => {
		if (shared) return patch(shared, property, primitive)

		return (shared = Object.freeze(createType(property, primitive)))
	}
}

function createSharedReference<
	const P extends Record<keyof any, unknown>,
	const T extends TSchema
>() {
	let shared: Map<number, T>

	return (property: P, createType: (property: P) => T): Readonly<T> => {
		const hash = propertyChecksum(property)
		if (shared?.has(hash[0])) {
			const cached = shared.get(hash[0])!

			if (hash[1])
				return Object.assign(
					hash[1],
					cached as Record<string, unknown>
				) as Readonly<T>

			return cached
		}

		const type = Object.freeze(createType(property))
		if (!shared) {
			shared = new Map()
			sharedReferences.add(shared)
		}
		shared.set(hash[0], type)

		return type
	}
}

export function clearSharedReferences() {
	for (const shared of sharedReferences) shared.clear()
}

function propertyChecksum(
	property: Partial<BaseSchema> & Record<keyof any, unknown>
) {
	if (
		'title' in property ||
		'description' in property ||
		'tags' in property ||
		'examples' in property ||
		'error' in property ||
		'default' in property
	) {
		const {
			title,
			description,
			tags,
			examples,
			error,
			default: defaultValue,
			...rest
		} = property

		const meta: Record<string, unknown> = {}
		if (title !== undefined) meta['title'] = title
		if (description !== undefined) meta['description'] = description
		if (tags !== undefined) meta['tags'] = tags
		if (examples !== undefined) meta['examples'] = examples
		if (error !== undefined) meta['error'] = error
		if (defaultValue !== undefined) meta['default'] = defaultValue

		const entries = Object.entries(rest)
		switch (entries.length) {
			case 0:
				return [0, meta] as const

			case 1:
				return [checksum(entries[0].toString()), meta] as const

			default:
				return [checksum(entries.toSorted().toString()), meta] as const
		}
	}

	const entries = Object.entries(property)
	if (!entries.length) return [0] as const

	return [checksum(JSON.stringify(entries))] as const
}

type Refines<T> = [refine: (value: T) => boolean, message: string][]
function Refines<T extends TSchema>(schema: T, refines: Refines<Static<T>>) {
	for (const [refine, message] of refines)
		schema = Type.Refine(schema, refine, message)

	return schema
}

let StringifiedNumber: Type.TCodec<Type.TRefine<Type.TString>, number>
let emptyNumeric: Readonly<
	Type.TUnion<[Type.TNumber, Type.TCodec<Type.TRefine<Type.TString>, number>]>
>
let sharedNumeric: ReturnType<
	typeof createPrimitiveReference<
		TNumberOptions,
		ReturnType<typeof NumericWithProperty>,
		TNumber
	>
>
function Numeric(property?: TNumberOptions) {
	StringifiedNumber ??= Type.Decode(
		Type.Refine(Type.String(), (value) => !isNaN(+value), 'must be number'),
		(value) => +value
	)

	if (isEmpty(property))
		return (emptyNumeric ??= Object.freeze(
			elyType(
				ELYSIA_TYPES.Numeric,
				Union([Type.Number(), StringifiedNumber])
			)
		))

	sharedNumeric ??= createPrimitiveReference(t.Number())

	return sharedNumeric(property, NumericWithProperty, NumericPatch)
}

function NumericWithProperty(property: TNumberOptions, primitive: TNumber) {
	const number = Object.assign(property, primitive)

	return elyType(
		ELYSIA_TYPES.Numeric,
		Union([number, Type.Intersect([StringifiedNumber, number])])
	)
}

function NumericPatch(
	schema: ReturnType<typeof NumericWithProperty>,
	property: TNumberOptions,
	primitive: TNumber
) {
	const number = Object.assign(property, primitive)

	return Object.assign({}, schema, {
		anyOf: [
			number,
			{
				allOf: [schema.anyOf[1].allOf[0], number]
			}
		]
	})
}

let StringifiedInteger: Type.TCodec<Type.TRefine<Type.TString>, number>
let emptyInteger: Readonly<
	Type.TUnion<
		[Type.TInteger, Type.TCodec<Type.TRefine<Type.TString>, number>]
	>
>
let sharedInteger: ReturnType<
	typeof createPrimitiveReference<
		TNumberOptions,
		ReturnType<typeof IntegerWithProperty>,
		TInteger
	>
>
function Integer(property?: TNumberOptions) {
	StringifiedInteger = Type.Decode(
		Type.Refine(
			Type.String(),
			(value) => !isNaN(+value) && Number.isInteger(+value),
			'must be integer'
		),
		(value) => +value
	)

	if (isEmpty(property))
		return (emptyInteger ??= elyType(
			ELYSIA_TYPES.Integer,
			Union([Type.Integer(), StringifiedInteger])
		))

	sharedInteger ??= createPrimitiveReference(t.Integer())
	return sharedInteger(property, IntegerWithProperty, IntegerPatch)
}

function IntegerWithProperty(property: TNumberOptions, primitive: TInteger) {
	const integer = Object.assign(property, primitive)

	return elyType(
		ELYSIA_TYPES.Integer,
		Union([integer, Type.Intersect([StringifiedInteger, integer])])
	)
}

function IntegerPatch(
	schema: ReturnType<typeof IntegerWithProperty>,
	property: TNumberOptions,
	primitive: TInteger
) {
	const integer = Object.assign(property, primitive)

	return Object.assign({}, schema, {
		anyOf: [
			integer,
			{
				allOf: [schema.anyOf[1].allOf[0], integer]
			}
		]
	})
}

let StringifiedBoolean: Type.TCodec<Type.TRefine<Type.TString>, boolean>
let emptyBooleanString: Readonly<
	Type.TUnion<
		[Type.TCodec<Type.TRefine<Type.TString>, boolean>, Type.TBoolean]
	>
>
let sharedBooleanString: ReturnType<
	typeof createPrimitiveReference<
		TSchemaOptions,
		ReturnType<typeof BooleanStringWithProperty>,
		TBoolean
	>
>
function BooleanString(property?: TSchemaOptions) {
	StringifiedBoolean ??= Type.Decode(
		Type.Refine(
			Type.String(),
			(value) => value === 'true' || value === 'false',
			'must be boolean'
		),
		(value) => (value === 'true' ? true : false)
	)

	if (isEmpty(property))
		return (emptyBooleanString ??= elyType(
			ELYSIA_TYPES.BooleanString,
			Union([StringifiedBoolean, Type.Boolean()])
		))

	sharedBooleanString ??= createPrimitiveReference(t.Boolean())
	return sharedBooleanString(
		property,
		BooleanStringWithProperty,
		BooleanPatch
	)
}

function BooleanStringWithProperty(
	property: TSchemaOptions,
	primitive: TBoolean
) {
	const boolean = Object.assign(property, primitive)
	return elyType(
		ELYSIA_TYPES.BooleanString,
		Union([boolean, Type.Intersect([StringifiedBoolean, boolean])])
	)
}

function BooleanPatch(
	schema: ReturnType<typeof BooleanStringWithProperty>,
	property: TSchemaOptions,
	primitive: TBoolean
) {
	const boolean = Object.assign(property, primitive)

	return Object.assign({}, schema, {
		anyOf: [boolean, schema.anyOf[1]]
	})
}

let BaseObjectString: Type.TCodec<
	Type.TRefine<Type.TString>,
	Record<string | number | symbol, unknown>
>
function ObjectString<T extends TProperties>(
	property: T,
	options?: TObjectOptions
) {
	BaseObjectString ??= Object.freeze(
		Type.Decode(
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
						JSON.parse(value)

						return true
					} catch {
						return false
					}
				},
				'must be an object'
			),
			(value) => JSON.parse(value)
		)
	)

	const object = ObjectType(property, options)
	return elyType(
		ELYSIA_TYPES.ObjectString,
		Union([object, Type.Intersect([BaseObjectString, object])])
	)
}

let BaseArrayString: Type.TCodec<Type.TRefine<Type.TString>, any>
function ArrayString<T extends TProperties>(
	property: T,
	options?: TObjectOptions
) {
	BaseArrayString ??= Type.Decode(
		Type.Refine(
			Type.String(),
			(value) => {
				if (
					value.charCodeAt(0) !== 91 &&
					value.charCodeAt(value.length - 1) !== 93
				)
					return false

				try {
					JSON.parse(value)

					return true
				} catch {
					return false
				}
			},
			'must be an array'
		),
		(value) => JSON.parse(value)
	)

	const array = ArrayType(property, options)
	return elyType(
		ELYSIA_TYPES.ArrayString,
		Union([array, Type.Intersect([BaseArrayString, array])])
	)
}

let StringifiedDate: Type.TCodec<
	Type.TUnion<[Type.TRefine<Type.TUnsafe<Date>>, Type.TString]>,
	Date
>
let emptyDate: Type.TCodec<
	Type.TUnion<[Type.TRefine<Type.TUnsafe<Date>>, Type.TString]>,
	Date
>
let sharedDate: ReturnType<
	typeof createSharedReference<
		DateOptions,
		ReturnType<typeof DateWithProperty>
	>
>
function DateType(property?: DateOptions) {
	StringifiedDate ??= Type.Codec(
		Union([
			Type.Refine(
				Type.Unsafe<Date>({ '~kind': 'Date' }),
				(value) => value instanceof Date,
				'must be Date'
			),
			Type.String({
				format: 'date'
			})
		])
	)
		.Decode((value) => (value instanceof Date ? value : new Date(value)))
		.Encode((value) =>
			value instanceof Date ? value.toISOString() : value + ''
		)

	if (isEmpty(property))
		return (emptyDate ??= Object.freeze(
			elyType(ELYSIA_TYPES.Date, StringifiedDate)
		))

	sharedDate ??= createSharedReference()
	return sharedDate(property, DateWithProperty)
}

function DateWithProperty(options: DateOptions) {
	const refines: Refines<Date> = []

	if (options.minimumTimestamp)
		refines.push([
			(value) => value.getTime() > options.minimumTimestamp!,
			`date must be after ${new Date(options.minimumTimestamp!).toISOString()}`
		])

	if (options.maximumTimestamp)
		refines.push([
			(value) => value.getTime() < options.maximumTimestamp!,
			`date must be before ${new Date(options.maximumTimestamp!).toISOString()}`
		])

	if (options.exclusiveMinimumTimestamp)
		refines.push([
			(value) => value.getTime() >= options.exclusiveMinimumTimestamp!,
			`date must be after or equal to ${new Date(options.exclusiveMinimumTimestamp!).toISOString()}`
		])

	if (options.exclusiveMaximumTimestamp)
		refines.push([
			(value) => value.getTime() <= options.exclusiveMaximumTimestamp!,
			`date must be before or equal to ${new Date(options.exclusiveMaximumTimestamp!).toISOString()}`
		])

	return elyType(ELYSIA_TYPES.Date, Refines(StringifiedDate, refines as any))
}

const Nullable = <T extends TSchema>(schema: T, options?: TSchemaOptions) =>
	elyType(
		ELYSIA_TYPES.Nullable,
		Union([schema, t.Null()], assignOrNew(options, { nullable: true }))
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

function checkFileExtension(type: string, extension: string) {
	if (type.startsWith(extension)) return true

	return (
		extension.charCodeAt(extension.length - 1) === 42 &&
		extension.charCodeAt(extension.length - 2) === 47 &&
		type.startsWith(extension.slice(0, -1))
	)
}

function parseFileUnit(size: FileUnit) {
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

let BaseFile: Type.TRefine<Type.TUnsafe<File>>
let emptyFile: Readonly<Type.TRefine<Type.TUnsafe<File>>>
let sharedFile: ReturnType<
	typeof createSharedReference<
		FileOptions,
		ReturnType<typeof FileWithProperty>
	>
>
function File(options?: FileOptions) {
	BaseFile ??= Type.Refine(
		Type.Unsafe<File>({ '~kind': 'File' }),
		(value) =>
			// @ts-expect-error
			value instanceof Blob || value instanceof ElysiaFile,
		'must be instance of Blob'
	)

	if (isEmpty(options))
		return (emptyFile ??= Object.freeze(
			elyType(ELYSIA_TYPES.File, BaseFile)
		))

	sharedFile ??= createSharedReference()
	return sharedFile(options, FileWithProperty)
}

function FileWithProperty(options: FilesOptions) {
	const refines: Refines<File> = []

	if (options.minSize) {
		const minSize = parseFileUnit(options.minSize!)

		refines.push([
			(value) => value.size > minSize,
			`Expect file size to be more than ${options.minSize}`
		])
	}

	if (options.maxSize) {
		const maxSize = parseFileUnit(options.maxSize!)

		refines.push([
			(value) => value.size < maxSize,
			`Expect file size to be less than ${options.maxSize}`
		])
	}

	if (options.type) {
		if (typeof options.type === 'string')
			refines.push([
				(value) =>
					checkFileExtension(value.type, options.type as FileType),
				`Expect file type to be ${options.type}`
			])
		else
			refines.push([
				(value) => {
					for (let i = 0; i < options.type!.length; i++)
						if (checkFileExtension(value.type, options.type![i]))
							return true

					return false
				},
				`Expect file type to be one of ${options.type.join(', ')}`
			])
	}

	return elyType(ELYSIA_TYPES.File, Refines(BaseFile, refines))
}

let BaseFiles: Type.TUnion<
	[
		Type.TArray<Readonly<Type.TRefine<Type.TUnsafe<File>>>>,
		Type.TCodec<Readonly<Type.TRefine<Type.TUnsafe<File>>>, File[]>
	]
>
let emptyFiles: Readonly<
	Type.TUnion<
		[
			Type.TArray<Type.TUnsafe<File>>,
			Type.TCodec<Readonly<Type.TRefine<Type.TUnsafe<File>>>, File[]>
		]
	>
>
let sharedFiles: ReturnType<
	typeof createSharedReference<
		FilesOptions,
		ReturnType<typeof FilesWithProperty>
	>
>
function Files(options?: FilesOptions) {
	BaseFiles ??= Union([
		ArrayType(File()),
		Type.Decode(File(), (value) => [value])
	])

	if (isEmpty(options))
		return (emptyFiles ??= Object.freeze(
			elyType(ELYSIA_TYPES.Files, BaseFiles)
		))

	sharedFiles ??= createSharedReference()
	return sharedFiles(options, FilesWithProperty)
}

function FilesWithProperty(options: FilesOptions) {
	const refines: Refines<File[]> = []

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

	// refines not matched, expected Decode first
	return elyType(ELYSIA_TYPES.Files, Refines(BaseFiles, refines as any))
}

type BaseFormType<T extends Record<keyof any, unknown>> = Type.TCodec<
	Type.TRefine<Type.TUnsafe<ElysiaFormData<T>>>,
	(
		T extends Record<string, unknown>
			? { [K in keyof T]: T[K] extends Blob | ElysiaFile ? File : T[K] }
			: T extends Blob | ElysiaFile
				? File
				: T
	) extends infer A
		? {
				[key in keyof A]: IsTuple<A[key]> extends true
					? // @ts-expect-error
						A[key][number] extends Blob | ElysiaFile
						? File[]
						: A[key]
					: A[key]
			}
		: T
>
let BaseForm: BaseFormType<any>
const Form = <T extends TProperties>(property: T, options?: TObjectOptions) => {
	BaseForm ??= Object.freeze(
		Type.Decode(
			Type.Refine(
				Type.Unsafe<any>({ '~kind': 'FormData' }),
				(value) => '~ely-form' in value,
				'must be instance of Elysia.form'
			),
			(value) => value['~ely-form']
		)
	)

	return elyType(
		ELYSIA_TYPES.Form,
		Type.Intersect([
			BaseForm as unknown as BaseFormType<T>,
			Type.Object(property, options)
		])
	)
}

const NoValidate = <T extends TSchema>(v: T, enabled = true) =>
	enabled ? elyType(ELYSIA_TYPES.NoValidate, v) : v

let BaseArrayBuffer: Type.TRefine<Type.TUnsafe<ArrayBuffer>>
let emptyArrayBuffer: Type.TRefine<Type.TUnsafe<ArrayBuffer>>
function ArrayBufferType(property?: ArrayBufferOptions) {
	BaseArrayBuffer ??= Type.Refine(
		Type.Unsafe<ArrayBuffer>({ '~kind': 'ArrayBuffer' }),
		(value) => value instanceof ArrayBuffer,
		'must be ArrayBuffer'
	)

	if (isEmpty(property))
		return (emptyArrayBuffer ??= Object.freeze(
			elyType(ELYSIA_TYPES.ArrayBuffer, BaseArrayBuffer)
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

	return elyType(ELYSIA_TYPES.ArrayBuffer, Refines(BaseArrayBuffer, refines))
}

let BaseUint8Array: Type.TRefine<Type.TUnsafe<Uint8Array>>
let emptyUint8Array: Readonly<Type.TRefine<Type.TUnsafe<Uint8Array>>>
function Uint8ArrayType(property?: ArrayBufferOptions) {
	BaseUint8Array ??= Type.Refine(
		Type.Unsafe<Uint8Array>({ '~kind': 'Uint8Array' }),
		(value) => value instanceof Uint8Array,
		'must be Uint8Array'
	)

	if (isEmpty(property))
		return (emptyUint8Array ??= Object.freeze(
			elyType(ELYSIA_TYPES.Uint8Array, BaseUint8Array)
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

	return elyType(ELYSIA_TYPES.Uint8Array, Refines(BaseUint8Array, refines))
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

type GetOwnPropertyDescriptor<T> = {
	[P in keyof T]: TypedPropertyDescriptor<T[P]>
} & {
	[x: string]: PropertyDescriptor
}

const defineKind = <T extends TSchema>(kind: string, schema: T) =>
	Object.defineProperty(schema, '~kind', {
		value: kind,
		enumerable: false,
		configurable: true,
		writable: true
	})

let emptyString: TString
let stringDescriptor: GetOwnPropertyDescriptor<TString>
function StringType(options?: TStringOptions): TString {
	emptyString ??= Object.freeze(Type.String())

	if (isEmpty(options)) return emptyString

	return Object.defineProperties(
		options,
		(stringDescriptor ??= Object.getOwnPropertyDescriptors(Type.String()))
	) as any
}

let emptyBoolean: Readonly<TBoolean>
let booleanDescriptor: GetOwnPropertyDescriptor<TBoolean>
function BooleanType(options?: TSchemaOptions): TBoolean {
	emptyBoolean ??= Object.freeze(Type.Boolean())

	if (isEmpty(options)) return emptyBoolean

	return Object.defineProperties(
		options,
		(booleanDescriptor ??= Object.getOwnPropertyDescriptors(Type.Boolean()))
	) as any
}

let emptyNumber: Readonly<TNumber>
let numberDescriptor: GetOwnPropertyDescriptor<TNumber>
function NumberType(options?: TNumberOptions): TNumber {
	emptyNumber ??= Object.freeze(Type.Number())

	if (isEmpty(options)) return emptyNumber

	return Object.defineProperties(
		options,
		(numberDescriptor ??= Object.getOwnPropertyDescriptors(Type.Number()))
	) as any
}

function ObjectType<T extends TProperties>(
	properties: T,
	options?: TObjectOptions
): TObject<T> {
	const required = Object.keys(properties)
	for (let i = 0; i < required.length; i++)
		// @ts-expect-error
		if (properties[required[i]]['~optional']) required.splice(i--, 1)

	if (isEmpty(options))
		return defineKind('Object', {
			type: 'object',
			properties,
			required
		}) as any

	options.type = 'object'
	options.properties = properties
	options.required = required
	return defineKind('Object', options) as any
}

function ArrayType<T extends TSchema>(
	items: T,
	options?: TSchemaOptions
): TArray<T> {
	if (isEmpty(options))
		return defineKind('Array', {
			type: 'array',
			items
		}) as any

	options.type = 'array'
	options.items = items
	return defineKind('Array', options) as any
}

let optionalDescriptor: {
	value: true
	enumerable: false
	configurable: true
	writable: true
}
function Optional<T extends TSchema>(schema: T): TOptional<T> {
	if ('~optional' in schema) return schema as any

	return Object.defineProperty(
		Object.defineProperties({}, Object.getOwnPropertyDescriptors(schema)),
		'~optional',
		(optionalDescriptor ??= {
			value: true,
			enumerable: false,
			configurable: true,
			writable: true
		})
	) as any
}

function Intersect<T extends TSchema[]>(schemas: T, options?: TSchemaOptions) {
	if (isEmpty(options))
		return defineKind('Intersect', {
			allOf: schemas
		}) as any

	options.allOf = schemas
	return defineKind('Intersect', options) as any
}

function Union<T extends TSchema[]>(schemas: T, options?: TSchemaOptions) {
	if (isEmpty(options))
		return defineKind('Union', {
			anyOf: schemas
		}) as any

	options.anyOf = schemas
	return defineKind('Union', options) as any
}

export const t = Object.freeze(
	Object.assign({}, Type, {
		String: StringType,
		Boolean: BooleanType,
		Number: NumberType,
		Object: ObjectType,
		Array: ArrayType,
		Intersect,
		Union,
		Optional,
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
)

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
