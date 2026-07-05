import * as TypeBox from 'typebox/type'
import type * as TypeBoxType from 'typebox/type'
import type * as TypeRegistry from './exports'

import { setupTypebox } from './compat'

import { Accelerate } from './elysia/accelerate'
import { ArrayType } from './elysia/array'
import { ArrayBufferType } from './elysia/array-buffer'
import { ArrayString } from './elysia/array-string'
import { BooleanType } from './elysia/boolean'
import { BooleanString } from './elysia/boolean-string'
import { Cookie } from './elysia/cookie'
import { DateType } from './elysia/date'
import { File } from './elysia/file'
import { Files } from './elysia/files'
import { Form } from './elysia/form'
import { Integer } from './elysia/integer'
import { Intersect } from './elysia/intersect'
import { IntegerString } from './elysia/integer-string'
import { MaybeEmpty } from './elysia/maybe-empty'
import { NoValidate } from './elysia/no-validate'
import { Nullable } from './elysia/nullable'
import { NumberType } from './elysia/number'
import { Numeric } from './elysia/numeric'
import { NumericEnum } from './elysia/numeric-enum'
import { ObjectType } from './elysia/object'
import { ObjectString } from './elysia/object-string'
import { Optional } from './elysia/optional'
import { StringType } from './elysia/string'
import { Uint8ArrayType } from './elysia/uint8-array'
import { Union } from './elysia/union'
import { UnionEnum } from './elysia/union-enum'

type TypeBuilder = Omit<typeof TypeBoxType, keyof typeof TypeRegistry> &
	typeof TypeRegistry

setupTypebox()

export const t = {
	...TypeBox,
	Accelerate,
	Array: ArrayType,
	ArrayBuffer: ArrayBufferType,
	ArrayString,
	Boolean: BooleanType,
	BooleanString,
	Cookie,
	Date: DateType,
	File,
	Files,
	Form,
	Integer,
	Intersect,
	IntegerString,
	MaybeEmpty,
	NoValidate,
	Nullable,
	Number: NumberType,
	Numeric,
	NumericEnum,
	Object: ObjectType,
	ObjectString,
	Optional,
	String: StringType,
	Uint8Array: Uint8ArrayType,
	Union,
	UnionEnum
} as unknown as TypeBuilder

export { setupTypebox } from './compat'
export { System as TypeSystem } from 'typebox/system'
export {
	fileType,
	setFileTypeDetector,
	type FileTypeDetector
} from './elysia/file-type'
export { TypeBoxValidator } from './validator'
export type {
	BaseSchema,
	AnySchema,
	TypeBoxSchema,
	StandardSchemaV1Like,
	StandardJSONSchemaV1Like
} from './types'
