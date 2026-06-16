import { decodeComponent } from 'deuri'

// bit flags
const KEY_HAS_PLUS = 1
const KEY_NEEDS_DECODE = 2
const VALUE_HAS_PLUS = 4
const VALUE_NEEDS_DECODE = 8

// NOTE: the charCode scanner + key/value prologue are intentionally duplicated
// between `parseQueryFromURL` and `parseQuery`. A shared scanner taking an
// `onPair` callback was measured ~10-12% SLOWER on the per-request hot path —
// the callback goes megamorphic (two call sites) and blocks inlining. Keep
// each parser's `processKeyValuePair` as its own monomorphic local closure.

// Parse query without array
export function parseQueryFromURL(
	input: string,
	startIndex = input.indexOf('?', 11),
	array?: { [key: string]: 1 },
	object?: { [key: string]: 1 }
): Record<string, string> {
	const result = Object.create(null)
	if (startIndex === -1) return result

	let flags = 0

	const inputLength = input.length
	let startingIndex = startIndex
	let equalityIndex = startingIndex

	// Scan only the query string (after '?'). Starting at 0 fed the whole
	// scheme/host/path through the switch: a literal '&' in the matched path
	// (a legal pchar, reachable via `/:param`) reset state into the path and
	// corrupted the parsed query; '%'/'+'/'=' in the path also set stale flags.
	for (let i = startIndex + 1; i < inputLength; i++)
		switch (input.charCodeAt(i)) {
			// '&'
			case 38:
				processKeyValuePair(input, i)

				// Reset state variables
				startingIndex = i
				equalityIndex = i
				flags = 0

				break

			// '='
			case 61:
				if (equalityIndex <= startingIndex) equalityIndex = i
				// If '=' character occurs again, we should decode the input
				else flags |= VALUE_NEEDS_DECODE

				break

			// '+'
			case 43:
				if (equalityIndex > startingIndex) flags |= VALUE_HAS_PLUS
				else flags |= KEY_HAS_PLUS

				break

			// '%'
			case 37:
				if (equalityIndex > startingIndex) flags |= VALUE_NEEDS_DECODE
				else flags |= KEY_NEEDS_DECODE

				break
		}

	// Process the last pair if needed
	if (startingIndex < inputLength) processKeyValuePair(input, inputLength)

	return result

	function processKeyValuePair(input: string, endIndex: number) {
		const hasBothKeyValuePair = equalityIndex > startingIndex
		const effectiveEqualityIndex = hasBothKeyValuePair
			? equalityIndex
			: endIndex

		const keySlice = input.slice(startingIndex + 1, effectiveEqualityIndex)

		// Skip processing if key is empty
		if (!hasBothKeyValuePair && keySlice.length === 0) return

		let finalKey = keySlice
		if (flags & KEY_HAS_PLUS) finalKey = finalKey.replace(/\+/g, ' ')
		if (flags & KEY_NEEDS_DECODE)
			finalKey = decodeComponent(finalKey) || finalKey

		let finalValue = ''
		if (hasBothKeyValuePair) {
			let valueSlice = input.slice(equalityIndex + 1, endIndex)
			if (flags & VALUE_HAS_PLUS)
				valueSlice = valueSlice.replace(/\+/g, ' ')
			if (flags & VALUE_NEEDS_DECODE)
				valueSlice = decodeComponent(valueSlice) || valueSlice
			finalValue = valueSlice
		}

		const currentValue = result[finalKey]

		if (array && array?.[finalKey]) {
			if (finalValue.charCodeAt(0) === 91) {
				if (object && object?.[finalKey])
					try {
						finalValue = JSON.parse(finalValue) as any
					} catch {
						finalValue = finalValue.slice(1, -1).split(',') as any
					}
				else finalValue = finalValue.slice(1, -1).split(',') as any

				if (currentValue === undefined) result[finalKey] = finalValue
				else if (Array.isArray(currentValue))
					currentValue.push(...finalValue)
				else {
					result[finalKey] = finalValue
					result[finalKey].unshift(currentValue)
				}
			} else {
				if (
					object &&
					object?.[finalKey] &&
					finalValue.charCodeAt(0) === 123
				) {
					try {
						finalValue = JSON.parse(finalValue) as any
					} catch {}
				} else if (
					currentValue === undefined &&
					!(object && object?.[finalKey]) &&
					finalValue.indexOf(',') !== -1
				)
					finalValue = finalValue.split(',') as any

				if (currentValue === undefined) {
					result[finalKey] = Array.isArray(finalValue)
						? finalValue
						: [finalValue]
				} else if (Array.isArray(currentValue))
					currentValue.push(finalValue)
				else result[finalKey] = [currentValue, finalValue]
			}
		} else if (object?.[finalKey] && finalValue.charCodeAt(0) === 123) {
			try {
				result[finalKey] = JSON.parse(finalValue)
			} catch {
				result[finalKey] = finalValue
			}
		} else {
			result[finalKey] = finalValue
		}
	}
}

/**
 * @callback parse
 * @param {string} input
 */
export function parseQuery(input: string) {
	const result = Object.create(null) as Record<string, string | string[]>

	let flags = 0

	const inputLength = input.length
	let startingIndex = -1
	let equalityIndex = -1

	for (let i = 0; i < inputLength; i++)
		switch (input.charCodeAt(i)) {
			// '&'
			case 38:
				processKeyValuePair(input, i)

				// Reset state variables
				startingIndex = i
				equalityIndex = i
				flags = 0

				break

			// '='
			case 61:
				if (equalityIndex <= startingIndex) equalityIndex = i
				// If '=' character occurs again, we should decode the input
				else flags |= VALUE_NEEDS_DECODE

				break

			// '+'
			case 43:
				if (equalityIndex > startingIndex) flags |= VALUE_HAS_PLUS
				else flags |= KEY_HAS_PLUS

				break

			// '%'
			case 37:
				if (equalityIndex > startingIndex) flags |= VALUE_NEEDS_DECODE
				else flags |= KEY_NEEDS_DECODE

				break
		}

	// Process the last pair if needed
	if (startingIndex < inputLength) processKeyValuePair(input, inputLength)

	return result

	function processKeyValuePair(input: string, endIndex: number) {
		const hasBothKeyValuePair = equalityIndex > startingIndex
		const effectiveEqualityIndex = hasBothKeyValuePair
			? equalityIndex
			: endIndex

		const keySlice = input.slice(startingIndex + 1, effectiveEqualityIndex)

		// Skip processing if key is empty
		if (!hasBothKeyValuePair && keySlice.length === 0) return

		let finalKey = keySlice
		if (flags & KEY_HAS_PLUS) finalKey = finalKey.replace(/\+/g, ' ')
		if (flags & KEY_NEEDS_DECODE)
			finalKey = decodeComponent(finalKey) || finalKey

		let finalValue = ''
		if (hasBothKeyValuePair) {
			let valueSlice = input.slice(equalityIndex + 1, endIndex)
			if (flags & VALUE_HAS_PLUS)
				valueSlice = valueSlice.replace(/\+/g, ' ')
			if (flags & VALUE_NEEDS_DECODE)
				valueSlice = decodeComponent(valueSlice) || valueSlice
			finalValue = valueSlice
		}

		const currentValue = result[finalKey]
		if (currentValue === undefined) result[finalKey] = finalValue
		else if (Array.isArray(currentValue)) currentValue.push(finalValue)
		else result[finalKey] = [currentValue, finalValue]
	}
}
