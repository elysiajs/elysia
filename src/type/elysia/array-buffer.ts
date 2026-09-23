import { Refine, Unsafe } from '../typebox-type'
import type { TSchema } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { ArrayBufferOptions } from '../types'
import {
	elyType,
	Refines,
	withMeta,
	type Refines as RefinesType
} from './utils'

// `base`, refined by `minByteLength` / `maxByteLength` when given
export function bufferType(
	tag: ELYSIA_TYPES[keyof ELYSIA_TYPES],
	base: () => TSchema
) {
	let Base: TSchema | undefined
	let empty: TSchema | undefined

	return (property?: ArrayBufferOptions): any => {
		Base ??= base()

		if (!property || isEmpty(property))
			return (empty ??= Object.freeze(elyType(tag, Base)))

		// `base` already refines the instance type
		const refines: RefinesType<ArrayBufferLike> = []

		if (property.minByteLength !== undefined)
			refines.push([
				(value) => value.byteLength >= property.minByteLength!,
				`Expect byte to be more than ${property.minByteLength}`
			])

		if (property.maxByteLength !== undefined)
			refines.push([
				(value) => value.byteLength <= property.maxByteLength!,
				`Expect byte to be less than ${property.maxByteLength}`
			])

		return elyType(
			tag,
			withMeta(Refines(Base as any, refines as any), property)
		)
	}
}

const arrayBuffer = /* @__PURE__ */ bufferType(ELYSIA_TYPES.ArrayBuffer, () =>
	Refine(
		Unsafe<ArrayBuffer>({ '~kind': 'ArrayBuffer' }),
		(value: unknown) => value instanceof ArrayBuffer,
		() => 'must be ArrayBuffer'
	)
)

export function ArrayBufferType(property?: ArrayBufferOptions): any {
	return arrayBuffer(property)
}
