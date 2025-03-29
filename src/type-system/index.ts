import { Type, Kind } from '@sinclair/typebox'
import type {
	ArrayOptions,
	DateOptions,
	IntegerOptions,
	ObjectOptions,
	SchemaOptions,
	TAnySchema,
	TArray,
	TBoolean,
	TDate,
	TEnumValue,
	TInteger,
	TNumber,
	TObject,
	TProperties,
	TSchema,
	TString,
	NumberOptions,
	JavaScriptTypeBuilder
} from '@sinclair/typebox'

import './format'
import { compile, createType, tryParse, validateFile } from './utils'
import {
	CookieValidatorOptions,
	TFile,
	TFiles,
	FileOptions,
	FilesOptions,
	NonEmptyArray,
	TForm,
	TUnionEnum
} from './types'

import { ELYSIA_FORM_DATA, form } from '../utils'
import { ValidationError } from '../error'

const t = Object.assign({}, Type) as JavaScriptTypeBuilder & typeof ElysiaType

createType<TUnionEnum>(
	'UnionEnum',
	(schema, value) =>
		(typeof value === 'number' ||
			typeof value === 'string' ||
			value === null) &&
		schema.enum.includes(value as never)
)

const internalFiles = createType<FilesOptions, File[]>(
	'Files',
	(options, value) => {
		if (!Array.isArray(value)) return validateFile(options, value)

		if (options.minItems && value.length < options.minItems) return false

		if (options.maxItems && value.length > options.maxItems) return false

		for (let i = 0; i < value.length; i++)
			if (!validateFile(options, value[i])) return false

		return true
	}
) as unknown as TFiles

const internalFormData = createType<TForm, FormData>(
	'ElysiaForm',
	({ compiler, ...schema }, value) => {
		if (!(value instanceof FormData)) return false

		if (compiler) {
			if (!(ELYSIA_FORM_DATA in value))
				throw new ValidationError('property', schema, value)

			if (!compiler.Check(value[ELYSIA_FORM_DATA]))
				throw compiler.Error(value[ELYSIA_FORM_DATA])
		}

		return true
	}
) as unknown as TForm

export const ElysiaType = {
	Numeric: (property?: NumberOptions) => {
		const schema = Type.Number(property)
		const compiler = compile(schema)

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

				if (property && !compiler.Check(number))
					throw compiler.Error(value)

				return number
			})
			.Encode((value) => value) as any as TNumber
	},

	Integer: (property?: IntegerOptions): TInteger => {
		const schema = Type.Integer(property)
		const compiler = compile(schema)

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

				if (!compiler.Check(number)) throw compiler.Error(number)

				return number
			})
			.Encode((value) => value) as any as TInteger
	},

	Date: (property?: DateOptions) => {
		const schema = Type.Date(property)
		const compiler = compile(schema)

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

					if (!compiler.Check(date)) throw compiler.Error(date)

					return date
				}

				if (value instanceof Date) return value

				const date = new Date(value)

				if (!date || isNaN(date.getTime()))
					throw new ValidationError('property', schema, date)

				if (!compiler.Check(date)) throw compiler.Error(date)

				return date
			})
			.Encode((value) => value.toISOString()) as any as TDate
	},

	BooleanString: (property?: SchemaOptions) => {
		const schema = Type.Boolean(property)
		const compiler = compile(schema)

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

				if (value !== undefined && !compiler.Check(value))
					throw compiler.Error(value)

				return value
			})
			.Encode((value) => value) as any as TBoolean
	},

	ObjectString: <T extends TProperties>(
		properties: T,
		options?: ObjectOptions
	) => {
		const schema = t.Object(properties, options)
		const compiler = compile(schema)

		const defaultValue = JSON.stringify(compiler.Create())

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

					if (!compiler.Check((value = tryParse(value, schema))))
						throw compiler.Error(value)

					return compiler.Decode(value)
				}

				return value
			})
			.Encode((value) => {
				let original
				if (typeof value === 'string')
					value = tryParse((original = value), schema)

				if (!compiler.Check(value)) throw compiler.Error(value)

				return original ?? JSON.stringify(value)
			}) as any as TObject<T>
	},

	ArrayString: <T extends TSchema = TString>(
		children: T = t.String() as any,
		options?: ArrayOptions
	) => {
		const schema = t.Array(children, options)
		const compiler = compile(schema)

		const decode = (value: string, isProperty = false) => {
			if (value.charCodeAt(0) === 91) {
				if (!compiler.Check((value = tryParse(value, schema))))
					throw compiler.Error(value)

				return compiler.Decode(value)
			}

			// has , (as used in nuqs)
			if (value.indexOf(',') !== -1) {
				// const newValue = value.split(',').map((v) => v.trim())

				if (!compiler.Check(value)) throw compiler.Error(value)

				return compiler.Decode(value)
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
				let original
				if (typeof value === 'string')
					value = tryParse((original = value), schema)

				if (!compiler.Check(value))
					throw new ValidationError('property', schema, value)

				return original ?? JSON.stringify(value)
			}) as any as TArray<T>
	},

	File: createType<FileOptions, File>(
		'File',
		validateFile
	) as unknown as TFile,

	Files: (options: FilesOptions = {}) =>
		t
			.Transform(internalFiles(options))
			.Decode((value) => {
				if (Array.isArray(value)) return value
				return [value]
			})
			.Encode((value) => value) as unknown as TFiles,

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
		}: CookieValidatorOptions<T> = {}
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
			// default is need for generating error message
			default: values[0],
			...options,
			[Kind]: 'UnionEnum',
			...type,
			enum: values
		} as any as TUnionEnum<T>
	},

	NoValidate: <T extends TAnySchema>(v: T, enabled = true) => {
		v.noValidate = enabled

		return v
	},

	Form: <T extends TProperties>(
		v: T,
		options: ObjectOptions = {}
	): TForm<T> => {
		const schema = t.Object(v, {
			default: form({}),
			...options
		})
		const compiler = compile(schema)

		return t.Union([
			schema,
			// @ts-expect-error
			internalFormData({
				compiler
			})
		])
	}
}

t.BooleanString = ElysiaType.BooleanString
t.ObjectString = ElysiaType.ObjectString
t.ArrayString = ElysiaType.ArrayString
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
t.Nullable = (schema) => ElysiaType.Nullable(schema)
t.MaybeEmpty = ElysiaType.MaybeEmpty as any
t.Cookie = ElysiaType.Cookie
t.Date = ElysiaType.Date
t.UnionEnum = ElysiaType.UnionEnum
t.NoValidate = ElysiaType.NoValidate
t.Form = ElysiaType.Form

export { t }

export {
	TypeSystemPolicy,
	TypeSystem,
	TypeSystemDuplicateFormat,
	TypeSystemDuplicateTypeKind
} from '@sinclair/typebox/system'
export { TypeRegistry, FormatRegistry } from '@sinclair/typebox'
export { TypeCompiler, TypeCheck } from '@sinclair/typebox/compiler'
