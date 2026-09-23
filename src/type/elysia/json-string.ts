import { Decode, Refine } from '../typebox-type'
import { Check, Compile, Decode as decodeValue } from '../bridge'
import { dropCompiledSource } from '../shared'
import type { TSchema } from 'typebox'

import { StringType } from './string'

// Largest encoded payload the parse memo will hold. Past this, re-parsing in
// decode costs less than pinning the payload until the next successful decode
const MEMO_LIMIT = 8192

// JSON-encoded `inner`: a string opening with `open` (`[` / `{`) that parses
// to a valid `inner`, decoded to it
export function jsonString<T extends TSchema>(
	inner: T,
	open: number,
	message: string
) {
	let check: ((value: unknown) => boolean) | undefined

	let raw: string | undefined
	let parsed: unknown

	return Decode(
		Refine(
			StringType(),
			(value) => {
				if (value.charCodeAt(0) !== open) return false
				// the refine runs more than once per validation; only values
				// that already passed are memoized, so a hit is still a pass
				if (value === raw) return true

				try {
					const next = JSON.parse(value)

					if (!check)
						try {
							const compiled = Compile(inner) as any
							dropCompiledSource(compiled)

							check = (v) => compiled.Check(v)
						} catch {
							// schema TypeBox declines to compile, keep the interpreted walk
							check = (v) => Check(inner, v)
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
			() => message
		),
		(value) => {
			const decoded = value === raw ? parsed : JSON.parse(value)
			raw = undefined
			parsed = undefined

			return decodeValue(inner, decoded)
		}
	)
}
