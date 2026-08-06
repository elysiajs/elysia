import { Decode, Refine } from 'typebox/type'
import { Check, Compile, Decode as decodeValue } from '../bridge'
import type { TObjectOptions, TSchema } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { ArrayType } from './array'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'
import { nullObject } from '../../utils'

// Largest encoded payload the parse memo will hold. Past this, re-parsing in
// decode costs less than pinning the payload until the next successful decode
const MEMO_LIMIT = 8192

export function ArrayString<T extends TSchema>(
	property: T,
	_options?: TObjectOptions
) {
	const [constraints, meta] = getMeta((_options ?? nullObject()) as any)
	const array = ArrayType(property, constraints)

	let check: ((value: unknown) => boolean) | undefined

	const checkInner = (value: unknown) => {
		if (!check)
			try {
				const compiled = Compile(array) as any

				// since it's private, we can drop unused field to reduce memory usage
				if (compiled.evaluateResult)
					compiled.evaluateResult.code = undefined

				if (compiled.buildResult)
					compiled.buildResult.functions = undefined

				check = (v) => compiled.Check(v)
			} catch {
				// schema TypeBox declines to compile, keep the interpreted walk
				check = (v) => Check(array, v)
			}

		return check(value)
	}

	// one-slot memo so `Decode` reuses the parse the refine already paid for
	let raw: string | undefined
	let parsed: unknown

	const arrayString = Decode(
		Refine(
			StringType(),
			(value) => {
				if (value.charCodeAt(0) !== 91) return false
				// the refine runs more than once per validation; only values
				// that already passed are memoized, so a hit is still a pass
				if (value === raw) return true

				try {
					const next = JSON.parse(value)
					if (!checkInner(next)) return false

					if (value.length <= MEMO_LIMIT) {
						raw = value
						parsed = next
					}

					return true
				} catch {
					return false
				}
			},
			() => 'must be an array'
		),
		(value) => {
			const decoded = value === raw ? parsed : JSON.parse(value)
			raw = undefined
			parsed = undefined

			return decodeValue(array, decoded)
		}
	)

	return elyType(ELYSIA_TYPES.ArrayString, Union([array, arrayString], meta))
}
