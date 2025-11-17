import decode from 'fast-decode-uri-component'

// bit flags
const KEY_HAS_PLUS = 1
const KEY_NEEDS_DECODE = 2
const VALUE_HAS_PLUS = 4
const VALUE_NEEDS_DECODE = 8

// Parse query without array
export function parseQueryFromURL(
	input: string,
	startIndex: number = 0,
	array?: { [key: string]: 1 },
	object?: { [key: string]: 1 }
): Record<string, string> {
	const result = Object.create(null)

	let flags = 0

	const inputLength = input.length
	let startingIndex = startIndex - 1
	let equalityIndex = startingIndex

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

		if (array && array?.[finalKey]) {
			if (finalValue.charCodeAt(0) === 91) {
				if (object && object?.[finalKey])
					finalValue = JSON.parse(finalValue) as any
				else finalValue = finalValue.slice(1, -1).split(',') as any

				if (currentValue === undefined) result[finalKey] = finalValue
				else if (Array.isArray(currentValue))
					currentValue.push(...finalValue)
				else {
					result[finalKey] = finalValue
					result[finalKey].unshift(currentValue)
				}
			} else {
				if (currentValue === undefined) result[finalKey] = finalValue
				else if (Array.isArray(currentValue))
					currentValue.push(finalValue)
				else result[finalKey] = [currentValue, finalValue]
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
export function parseQueryStandardSchema(
	input: string,
	startIndex: number = 0
) {
	const result = Object.create(null) as Record<string, string | string[]>

	let flags = 0

	const inputLength = input.length
	let startingIndex = startIndex - 1
	let equalityIndex = startingIndex

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

		if (
			finalValue.charCodeAt(0) === 91 &&
			finalValue.charCodeAt(finalValue.length - 1) === 93
		) {
			try {
				// @ts-ignore
				finalValue = JSON.parse(finalValue)
			} catch {
				// If JSON parsing fails, treat it as a regular string
			}

			if (currentValue === undefined) result[finalKey] = finalValue
			else if (Array.isArray(currentValue)) currentValue.push(finalValue)
			else result[finalKey] = [currentValue, finalValue]
		} else if (
			finalValue.charCodeAt(0) === 123 &&
			finalValue.charCodeAt(finalValue.length - 1) === 125
		) {
			try {
				// @ts-ignore
				finalValue = JSON.parse(finalValue)
			} catch {
				// If JSON parsing fails, treat it as a regular string
			}

			if (currentValue === undefined) result[finalKey] = finalValue
			else if (Array.isArray(currentValue)) currentValue.push(finalValue)
			else result[finalKey] = [currentValue, finalValue]
		} else {
			if (finalValue.includes(','))
				// @ts-ignore
				finalValue = finalValue.split(',')

			if (currentValue === undefined) result[finalKey] = finalValue
			else if (Array.isArray(currentValue)) currentValue.push(finalValue)
			else result[finalKey] = [currentValue, finalValue]
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
