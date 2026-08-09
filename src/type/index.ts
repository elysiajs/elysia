import type * as TypeBoxType from 'typebox/type'
import type { System as TypeBoxSystem } from 'typebox/system'
import type * as TypeRegistry from './exports'

import { setupTypebox } from './compat'
import { loadTypeNamespace } from './typebox-type'

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

const hasOwn = (target: object, key: PropertyKey) =>
	Object.prototype.hasOwnProperty.call(target, key)

/**
 * A namespace object that materializes `typebox/type` only when a key it does
 * not own is actually read
 */
const lazyNamespace = <T extends object>(
	resolve: () => Record<PropertyKey, any>,
	overrides: object
): T =>
	new Proxy(overrides, {
		get: (target, key, receiver) =>
			key in target
				? Reflect.get(target, key, receiver)
				: resolve()[key as any],
		has: (target, key) => key in target || key in resolve(),
		ownKeys(target) {
			const keys = Object.keys(resolve())

			for (const key of Object.getOwnPropertyNames(target))
				if (!keys.includes(key)) keys.push(key)

			return keys
		},
		getOwnPropertyDescriptor(target, key) {
			if (hasOwn(target, key))
				return Reflect.getOwnPropertyDescriptor(target, key)

			const ns = resolve()
			if (!hasOwn(ns, key)) return

			return {
				value: ns[key],
				enumerable: true,
				writable: true,
				configurable: true
			}
		},
		// Sealing/freezing cannot work, the TypeBox-provided keys do not live
		// on the target and cannot be re-defined onto it
		// Refuse up front so `Object.freeze(t)` throws before it makes the
		// target non-extensible; otherwise the failed freeze would leave `ownKeys` permanently
		preventExtensions: () => false,
		set: (target, key, value) => Reflect.set(target, key, value),
		defineProperty: (target, key, descriptor) =>
			Reflect.defineProperty(target, key, descriptor),
		deleteProperty: (target, key) => Reflect.deleteProperty(target, key)
	}) as T

export const t = lazyNamespace<TypeBuilder>(() => loadTypeNamespace().type, {
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
})

export { setupTypebox } from './compat'

/**
 * `typebox/system` is a subgraph of `typebox/type`, so a static re-export here
 * would pin ~231 KB of the deferral back into the eager graph. The proxy also
 * guarantees Elysia's own `Settings` default lands BEFORE the namespace is
 * handed out, keeping a user's explicit `TypeSystem.Settings.Set(...)` last —
 * the ordering the eager `setupTypebox()` used to provide
 */
export const TypeSystem: typeof TypeBoxSystem = lazyNamespace(
	() => loadTypeNamespace().system.System,
	Object.create(null)
)
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
