import { Codec, Refine, Unsafe } from '../typebox-type'

import { ELYSIA_TYPES } from '../constants'
import type { ArrayBufferOptions } from '../types'
import { bufferType } from './array-buffer'

// Accept both Uint8Array and ArrayBuffer (L09)
const isUint8Array = (value: unknown) =>
	value instanceof Uint8Array || value instanceof ArrayBuffer

const uint8Array = /* @__PURE__ */ bufferType(ELYSIA_TYPES.Uint8Array, () =>
	Codec(
		Refine(
			Unsafe<Uint8Array>({ '~kind': 'Uint8Array' }),
			isUint8Array,
			() => 'must be Uint8Array'
		)
	)
		.Decode((value: unknown) =>
			value instanceof Uint8Array
				? value
				: new Uint8Array(value as ArrayBuffer)
		)
		.Encode((value) => value)
)

export const Uint8ArrayType = (property?: ArrayBufferOptions) =>
	uint8Array(property)
