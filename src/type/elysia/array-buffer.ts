import { Refine, Unsafe } from '../typebox-type'
import type { Static, TSchema } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { ArrayBufferOptions } from '../types'
import {
	elyType,
	Refines,
	withMeta,
	type Refines as RefinesType
} from './utils'

// `createBase()`, refined by `minByteLength` / `maxByteLength` when given
export function bufferType<S extends TSchema>(
	tag: ELYSIA_TYPES[keyof ELYSIA_TYPES],
	createBase: () => S
) {
	let base: S | undefined
	let empty: Readonly<S> | undefined

	return (property?: ArrayBufferOptions): Readonly<S> => {
		base ??= createBase()

		if (!property || isEmpty(property))
			return (empty ??= Object.freeze(elyType(tag, base)))

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
			withMeta(Refines(base, refines as RefinesType<Static<S>>), property)
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

export function ArrayBufferType(property?: ArrayBufferOptions) {
	return arrayBuffer(property)
}
