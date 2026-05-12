import { Type } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { ArrayBufferOptions } from '../types'
import {
	elyType,
	Refines,
	type Refines as RefinesType
} from './utils'

let BaseUint8Array: Type.TRefine<Type.TUnsafe<Uint8Array>>
let emptyUint8Array: Readonly<Type.TRefine<Type.TUnsafe<Uint8Array>>>
export function Uint8ArrayType(property?: ArrayBufferOptions) {
	BaseUint8Array ??= Type.Refine(
		Type.Unsafe<Uint8Array>({ '~kind': 'Uint8Array' }),
		(value) => value instanceof Uint8Array,
		'must be Uint8Array'
	)

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

	return elyType(ELYSIA_TYPES.Uint8Array, Refines(BaseUint8Array, refines))
}
