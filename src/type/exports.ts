import * as type from 'typebox/type'
import * as system from 'typebox/system'

import { setupTypebox } from './compat'
import { injectTypeboxType } from './typebox-type'

// This subpath statically imports TypeBox anyway, so close the lazy latch with
// the very same namespaces instead of letting a later `t.*` call `require` them
// a second time. Also restores this subpath's Settings-at-import guarantee
injectTypeboxType({ type, system })

setupTypebox()

export * from 'typebox/type'

export { Accelerate } from './elysia/accelerate'
export { ArrayType as Array } from './elysia/array'
export { ArrayBufferType as ArrayBuffer } from './elysia/array-buffer'
export { ArrayString } from './elysia/array-string'
export { BooleanType as Boolean } from './elysia/boolean'
export { BooleanString } from './elysia/boolean-string'
export { CompositeType as Composite } from './elysia/keep-config'
export { Cookie } from './elysia/cookie'
export { DateType as Date } from './elysia/date'
export { EvaluateType as Evaluate } from './elysia/keep-config'
export { File } from './elysia/file'
export { Files } from './elysia/files'
export { Form } from './elysia/form'
export { Integer } from './elysia/integer'
export { InterfaceType as Interface } from './elysia/keep-config'
export { Intersect } from './elysia/intersect'
export { IntegerString } from './elysia/integer-string'
export { MappedType as Mapped } from './elysia/keep-config'
export { MaybeEmpty } from './elysia/maybe-empty'
export { NoValidate } from './elysia/no-validate'
export { Nullable } from './elysia/nullable'
export { NumberType as Number } from './elysia/number'
export { Numeric } from './elysia/numeric'
export { NumericEnum } from './elysia/numeric-enum'
export { ObjectType as Object } from './elysia/object'
export { ObjectString } from './elysia/object-string'
export { OmitType as Omit } from './elysia/keep-config'
export { Optional } from './elysia/optional'
export { PartialType as Partial } from './elysia/keep-config'
export { PickType as Pick } from './elysia/keep-config'
export { Problem } from './elysia/problem'
export { ReadonlyObjectType as ReadonlyObject } from './elysia/keep-config'
export { RequiredType as Required } from './elysia/keep-config'
export { StringType as String } from './elysia/string'
export { Uint8ArrayType as Uint8Array } from './elysia/uint8-array'
export { Union } from './elysia/union'
export { UnionEnum } from './elysia/union-enum'
