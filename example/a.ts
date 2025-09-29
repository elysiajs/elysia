import { Elysia, t } from '../src'
import { parseCookie } from '../src/cookies'
import { req } from '../test/utils'

console.log(getLastBalancedParenIndex(`a({ hello: a() }).thing`))

function getLastBalancedParenIndex(input: string): number {
	let depth = 0
	let lastBalancedIndex = -1

	for (let i = 0; i < input.length; i++) {
		const char = input[i]

		if (char === '(') {
			depth++
		} else if (char === ')') {
			if (depth > 0) {
				depth--
				// when depth goes back to 0, it's a balanced pair
				if (depth === 0) {
					lastBalancedIndex = i
				}
			} else {
				// Unbalanced closing bracket
				return -1
			}
		}
	}

	return lastBalancedIndex
}
