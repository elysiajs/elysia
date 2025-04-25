import decode from 'fast-decode-uri-component'

// Parse query without array
export function parseQueryFromURL(
	input: string,
	startIndex: number = 0
): Record<string, string> {
	const result = Object.create(null)

	// bit flags
	const KEY_PLUS_FLAG = 1
	const KEY_DECODE_FLAG = 2
	const VALUE_PLUS_FLAG = 4
	const VALUE_DECODE_FLAG = 8

	let flags = 0
	let startingIndex = startIndex - 1
	let equalityIndex = startingIndex
	const inputLength = input.length

	// Main parsing loop
	for (let i = startIndex; i < inputLength; i++)
		switch (input.charCodeAt(i)) {
			// '&'
			case 38:
				processKeyValuePair(i)

				// Reset for next pair
				startingIndex = i
				equalityIndex = i
				flags = 0

				break

			// '='
			case 61:
				if (equalityIndex <= startingIndex) equalityIndex = i
				else flags |= VALUE_DECODE_FLAG

				break

			// '+'
			case 43:
				if (equalityIndex > startingIndex) flags |= VALUE_PLUS_FLAG
				else flags |= KEY_PLUS_FLAG

				break

			// '%'
			case 37:
				if (equalityIndex > startingIndex) flags |= VALUE_DECODE_FLAG
				else flags |= KEY_DECODE_FLAG

				break
		}

	// Process the last pair if there is one
	processKeyValuePair(inputLength)

	return result

	function processKeyValuePair(endIndex: number) {
		const hasBothKeyValuePair = equalityIndex > startingIndex
		const keyEndIndex = hasBothKeyValuePair ? equalityIndex : endIndex

		// Extract and process key only if the slice is not empty
		if (keyEndIndex <= startingIndex + 1) return

		let keySlice = input.slice(startingIndex + 1, keyEndIndex)
		if (flags & KEY_PLUS_FLAG) keySlice = keySlice.replace(/\+/g, ' ')
		if (flags & KEY_DECODE_FLAG) keySlice = decode(keySlice) || keySlice

		// Only add to result if this key doesn't already exist
		if (result[keySlice] !== undefined) return

		// Process value if it exists
		let finalValue = ''
		if (hasBothKeyValuePair) {
			finalValue = input.slice(equalityIndex + 1, endIndex)

			if (flags & VALUE_PLUS_FLAG)
				finalValue = finalValue.replace(/\+/g, ' ')
			if (flags & VALUE_DECODE_FLAG)
				finalValue = decode(finalValue) || finalValue
		}

		result[keySlice] = finalValue
	}
}

/**
 * @callback parse
 * @param {string} input
 */
export function parseQuery(input: string) {
	const result = Object.create(null) as Record<string, string | string[]>

	// bit flags
	let flags = 0
	const KEY_HAS_PLUS = 1
	const KEY_NEEDS_DECODE = 2
	const VALUE_HAS_PLUS = 4
	const VALUE_NEEDS_DECODE = 8

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
		if (flags & KEY_NEEDS_DECODE) finalKey = decode(finalKey) || finalKey

		let finalValue = ''
		if (hasBothKeyValuePair) {
			let valueSlice = input.slice(equalityIndex + 1, endIndex)
			if (flags & VALUE_HAS_PLUS)
				valueSlice = valueSlice.replace(/\+/g, ' ')
			if (flags & VALUE_NEEDS_DECODE)
				valueSlice = decode(valueSlice) || valueSlice
			finalValue = valueSlice
		}

		const currentValue = result[finalKey]
		if (currentValue === undefined) result[finalKey] = finalValue
		else if (Array.isArray(currentValue)) currentValue.push(finalValue)
		else result[finalKey] = [currentValue, finalValue]
	}
}
