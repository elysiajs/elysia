import { Refine, Unsafe } from 'typebox/type'
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

let BaseArrayBuffer: Type.TRefine<Type.TUnsafe<ArrayBuffer>>
let emptyArrayBuffer: Type.TRefine<Type.TUnsafe<ArrayBuffer>>
export function ArrayBufferType(property?: ArrayBufferOptions) {
	BaseArrayBuffer ??= Refine(
		Unsafe<ArrayBuffer>({ '~kind': 'ArrayBuffer' }),
		(value) => value instanceof ArrayBuffer,
		() => 'must be ArrayBuffer'
	)

	if (!property || isEmpty(property))
		return (emptyArrayBuffer ??= Object.freeze(
			elyType(ELYSIA_TYPES.ArrayBuffer, BaseArrayBuffer)
		))

	const refines: RefinesType<ArrayBuffer> = [
		[(value) => value instanceof ArrayBuffer, 'must be ArrayBuffer']
	]

	if (property.minByteLength)
		refines.push([
			(value) => value.byteLength >= property.minByteLength!,
			`Expect byte to be more than ${property.minByteLength}`
		])

	if (property.maxByteLength)
		refines.push([
			(value) => value.byteLength <= property.maxByteLength!,
			`Expect byte to be less than ${property.maxByteLength}`
		])

	let schema: any = Refines(BaseArrayBuffer, refines)
	const [, meta] = getMeta(property as any)
	if (meta) {
		schema = cloneSchema(schema)
		Object.assign(schema, meta)
	}

	return elyType(ELYSIA_TYPES.ArrayBuffer, schema)
}
