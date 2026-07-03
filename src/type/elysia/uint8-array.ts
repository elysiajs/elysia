import { Codec, Refine, Unsafe } from 'typebox/type'
import type { Type } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { ArrayBufferOptions } from '../types'
import {
	cloneSchema,
	elyType,
	getMeta,
	Refines,
	type Refines as RefinesType
} from './utils'

let BaseUint8Array: Type.TCodec<Type.TRefine<Type.TUnsafe<Uint8Array>>, Uint8Array>
let emptyUint8Array: Readonly<
	Type.TCodec<Type.TRefine<Type.TUnsafe<Uint8Array>>, Uint8Array>
>
export function Uint8ArrayType(property?: ArrayBufferOptions) {
	BaseUint8Array ??= Codec(
		Refine(
			Unsafe<Uint8Array>({ '~kind': 'Uint8Array' }),
			(value: unknown) =>
				value instanceof Uint8Array || value instanceof ArrayBuffer,
			() => 'must be Uint8Array'
		)
	)
		.Decode((value: unknown) =>
			value instanceof Uint8Array
				? value
				: new Uint8Array(value as ArrayBuffer)
		)
		.Encode((value) => value)

	if (!property || isEmpty(property))
		return (emptyUint8Array ??= Object.freeze(
			elyType(ELYSIA_TYPES.Uint8Array, BaseUint8Array)
		))

	const refines: RefinesType<Uint8Array> = [
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

	let schema: any = Refines(BaseUint8Array, refines)
	const [, meta] = getMeta(property as any)
	if (meta) {
		schema = cloneSchema(schema)
		Object.assign(schema, meta)
	}

	return elyType(ELYSIA_TYPES.Uint8Array, schema)
}
