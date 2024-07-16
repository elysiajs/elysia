/**
@from https://github.com/anonrig/fast-querystring/tree/main

Copyright (c) 2022 Yagiz Nizipli

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
*/

// @ts-ignore
import fastDecode from 'fast-decode-uri-component'

const plusRegex = /\+/g

/**
 * @callback parse
 * @param {string} input
 */
export function parseQuery(input: string) {
	const result = <Record<string, string>>{}

	if (typeof input !== 'string') return result

	const inputLength = input.length
	let key = ''
	let value = ''
	let startingIndex = -1
	let equalityIndex = -1
	let shouldDecodeKey = false
	let shouldDecodeValue = false
	let keyHasPlus = false
	let valueHasPlus = false
	let hasBothKeyValuePair = false
	let c = 0

	// Have a boundary of input.length + 1 to access last pair inside the loop.
	for (let i = 0; i < inputLength + 1; i++) {
		c = i !== inputLength ? input.charCodeAt(i) : 38

		// Handle '&' and end of line to pass the current values to result
		if (c === 38) {
			hasBothKeyValuePair = equalityIndex > startingIndex

			// Optimization: Reuse equality index to store the end of key
			if (!hasBothKeyValuePair) equalityIndex = i

			key = input.slice(startingIndex + 1, equalityIndex)

			// Add key/value pair only if the range size is greater than 1; a.k.a. contains at least "="
			if (hasBothKeyValuePair || key.length > 0) {
				// Optimization: Replace '+' with space
				if (keyHasPlus) key = key.replace(plusRegex, ' ')

				// Optimization: Do not decode if it's not necessary.
				if (shouldDecodeKey) key = fastDecode(key) || key

				if (!result[key]) {
					if (hasBothKeyValuePair) {
						value = input.slice(equalityIndex + 1, i)

						if (valueHasPlus) value = value.replace(plusRegex, ' ')

						if (shouldDecodeValue)
							value = fastDecode(value) || value
					}

					result[key] = value
				}
			}

			// Reset reading key value pairs
			value = ''
			startingIndex = i
			equalityIndex = i
			shouldDecodeKey = false
			shouldDecodeValue = false
			keyHasPlus = false
			valueHasPlus = false
		}
		// Check '='
		else if (c === 61) {
			if (equalityIndex <= startingIndex) equalityIndex = i
			// If '=' character occurs again, we should decode the input.
			else shouldDecodeValue = true
		}
		// Check '+', and remember to replace it with empty space.
		else if (c === 43) {
			if (equalityIndex > startingIndex) valueHasPlus = true
			else keyHasPlus = true
		}
		// Check '%' character for encoding
		else if (c === 37) {
			if (equalityIndex > startingIndex) shouldDecodeValue = true
			else shouldDecodeKey = true
		}
	}

	return result
}
