import { Decode, Refine } from '../typebox-type'
import { Check, Compile, Decode as decodeValue } from '../bridge'
import type { TObjectOptions, TProperties } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { ObjectType } from './object'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'
import { nullObject } from '../../utils'

// Largest encoded payload the parse memo will hold. Past this, re-parsing in
// decode costs less than pinning the payload until the next successful decode.
const MEMO_LIMIT = 8192

export function ObjectString<T extends TProperties>(
	property: T,
	_options?: TObjectOptions
) {
	const [{ properties, ...constraints }, meta] = getMeta(
		(_options ?? nullObject()) as any
	)
	const object = ObjectType(property, constraints)
	let check: ((value: unknown) => boolean) | undefined

	let raw: string | undefined
	let parsed: unknown

	const objectString = Decode(
		Refine(
			StringType(),
			(value) => {
				if (value.charCodeAt(0) !== 123) return false
				if (value === raw) return true

				try {
					const next = JSON.parse(value)

					if (!check)
						try {
							const compiled = Compile(object) as any

							// the refine runs more than once per validation; only values
							// that already passed are memoized, so a hit is still a pass
							if (compiled.evaluateResult)
								compiled.evaluateResult.code = undefined

							if (compiled.buildResult)
								compiled.buildResult.functions = undefined

							check = (v) => compiled.Check(v)
						} catch {
							check = (v) => Check(object, v)
						}

					if (!check(next)) {
						raw = parsed = undefined
						return false
					}

					// a request rejected after this point never reaches decode,
					// so the memo outlives it; cap what that can pin
					if (value.length <= MEMO_LIMIT) {
						raw = value
						parsed = next
					}

					return true
				} catch {
					// JSON.parse (or check) threw past the charCode fast-reject —
					// same reasoning as the `!check(next)` branch above
					raw = parsed = undefined
					return false
				}
			},
			() => 'must be an object'
		),
		(value) => {
			const decoded = value === raw ? parsed : JSON.parse(value)
			raw = undefined
			parsed = undefined

			return decodeValue(object, decoded)
		}
	)

	return elyType(
		ELYSIA_TYPES.ObjectString,
		Union([object, objectString], meta)
	)
}
