import { fnv1a, evictOldestHalf } from './utils'
import { getCompilerSession } from './compile/aot'

import type { Handler, AppHook } from './types'

export namespace Sucrose {
	export interface Inference {
		query: boolean
		headers: boolean
		body: boolean
		cookie: boolean
		set: boolean
		route: boolean
		afterResponse?: boolean
	}

	export type LifeCycle = Partial<Partial<AppHook>>
}

/**
 * Separate stringified function body and parameter
 *
 * @example
 * ```typescript
 * separateFunction('async ({ hello }) => { return hello }') // => ['({ hello })', '{ return hello }']
 * ```
 */
export function separateFunction(code: string): [string, string] {
	// Remove async keyword without removing space (both minify and non-minify)
	if (code.startsWith('async')) code = code.slice(5)
	code = code.trimStart()

	let index: number

	// JSC: Starts with '(', is an arrow function
	if (code.charCodeAt(0) === 40) {
		const parameterEnd = findClosingParenthesis(code, 0)
		index = code.indexOf('=>', parameterEnd)

		if (index !== -1) {
			let body = code.slice(index + 2)
			if (body.charCodeAt(0) === 32) body = body.trimStart()

			return [code.slice(1, parameterEnd), body]
		}
	}

	// V8: bracket is removed for 1 parameter arrow function
	if (/^([\w$]+)=>/g.test(code)) {
		index = code.indexOf('=>')

		if (index !== -1) {
			let body = code.slice(index + 2)
			if (body.charCodeAt(0) === 32) body = body.trimStart()

			return [code.slice(0, index), body]
		}
	}

	// Using function keyword
	if (code.startsWith('function')) {
		index = code.indexOf('(')
		const end = findClosingParenthesis(code, index)

		return [code.slice(index + 1, end), code.slice(end + 2)]
	}

	// Probably Declare as method
	const start = code.indexOf('(')

	if (start !== -1) {
		const sep = code.indexOf('\n', 2)
		const parameter = code.slice(0, sep)
		const end = parameter.lastIndexOf(')') + 1

		const body = code.slice(sep + 1)

		return [parameter.slice(start, end), '{' + body]
	}

	// Unknown case
	const x = code.split('\n', 2)

	return [x[0], x[1]]
}

function findClosingParenthesis(code: string, start: number) {
	let deep = 1

	for (let index = start + 1; index < code.length; index++) {
		const char = code.charCodeAt(index)

		if (char === 40) deep++
		else if (char === 41 && --deep === 0) return index
	}

	return start
}

/**
 * Get range between bracket pair
 *
 * @example
 * ```typescript
 * bracketPairRange('hello: { world: { a } }, elysia') // [6, 20]
 * ```
 */
export function bracketPairRange(parameter: string): [number, number] {
	const start = parameter.indexOf('{')
	if (start === -1) return [-1, 0]

	let end = start + 1
	let deep = 1

	for (; end < parameter.length; end++) {
		const char = parameter.charCodeAt(end)

		// Open bracket
		if (char === 123) deep++
		// Close bracket
		else if (char === 125) deep--

		if (deep === 0) break
	}

	if (deep !== 0) return [0, parameter.length]

	return [start, end + 1]
}

/**
 * Similar to `bracketPairRange` but in reverse order
 * Get range between bracket pair from end to beginning
 *
 * @example
 * ```typescript
 * bracketPairRange('hello: { world: { a } }, elysia') // [6, 20]
 * ```
 */
export function bracketPairRangeReverse(parameter: string): [number, number] {
	const end = parameter.lastIndexOf('}')
	if (end === -1) return [-1, 0]

	let start = end - 1
	let deep = 1

	for (; start >= 0; start--) {
		const char = parameter.charCodeAt(start)

		// Open bracket
		if (char === 125) deep++
		// Close bracket
		else if (char === 123) deep--

		if (deep === 0) break
	}

	if (deep !== 0) return [-1, 0]

	return [start, end + 1]
}

export function removeColonAlias(parameter: string) {
	while (true) {
		const start = parameter.indexOf(':')
		if (start === -1) break

		// Drop the `:alias`
		let end = start + 1
		while (end < parameter.length) {
			const char = parameter.charCodeAt(end)
			if (char !== 32 && char !== 9 && char !== 10) break
			end++
		}

		// Consume the alias identifier up to the next delimiter/whitespace.
		while (end < parameter.length) {
			const char = parameter.charCodeAt(end)

			// , } space \t \n
			if (
				char === 44 ||
				char === 125 ||
				char === 32 ||
				char === 9 ||
				char === 10
			)
				break
			end++
		}

		parameter = parameter.slice(0, start) + parameter.slice(end)
	}

	return parameter
}

/**
 * Retrieve only root parameters of a function
 *
 * @example
 * ```typescript
 * retrieveRootParameters('({ hello: { world: { a } }, elysia })') // => {
 *   parameters: ['hello', 'elysia'],
 *   hasParenthesis: true
 * }
 * ```
 */
export function retrieveRootparameters(parameter: string) {
	let hasParenthesis = false

	// Remove () from parameter
	if (parameter.charCodeAt(0) === 40) parameter = parameter.slice(1, -1)

	parameter = parameter.trim()

	if (parameter.indexOf('=') !== -1)
		parameter = removeDefaultParameter(parameter)

	// Remove {} from parameter
	if (parameter.charCodeAt(0) === 123) {
		hasParenthesis = true
		const [, end] = bracketPairRange(parameter)
		parameter = parameter.slice(1, end - 1)
	}

	parameter = parameter.replace(/\s+/g, '')
	const parameters = <string[]>[]

	// Object destructuring
	while (true) {
		let [start, end] = bracketPairRange(parameter)
		if (start === -1) break

		// Remove colon from object structuring cast
		parameters.push(removeColonAlias(parameter.slice(0, start - 1)))
		if (parameter.charCodeAt(end) === 44) end++
		parameter = parameter.slice(end)
	}

	parameter = removeColonAlias(parameter)
	if (parameter) parameters.push(parameter)

	// Defaults are gone and every whitespace character has been stripped, so
	// what is left is a plain comma-separated list of names
	const parameterMap: Record<string, true> = Object.create(null)
	for (const p of parameters) {
		if (p.indexOf(',') === -1) {
			parameterMap[p] = true
			continue
		}

		for (const q of p.split(',')) parameterMap[q] = true
	}

	return {
		hasParenthesis,
		parameters: parameterMap
	}
}

function findEndIndex(
	type: string,
	content: string,
	index?: number | undefined
) {
	let search = index ?? 0

	while (true) {
		const found = content.indexOf(type, search)
		if (found === -1) return -1

		switch (content.charCodeAt(found + type.length)) {
			case 10: // \n
			case 9: // \t
			case 44: // ,
			case 59: // ;
			case 32: // space
			case 41: // )
			case 125: // } end of a minified block, e.g. `{const a=body}`
				return found
		}

		search = found + 1
	}
}

/**
 * Find alias of variable from function body
 *
 * @example
 * ```typescript
 * findAlias('body', '{ const a = body, b = body }') // => ['a', 'b']
 * ```
 */
export function findAlias(
	type: string,
	body: string,
	seen: Set<string> = new Set()
) {
	const aliases: string[] = []

	let content = body

	const spaced = ' = ' + type
	const minified = '=' + type

	while (true) {
		let matchedLength = spaced.length
		let index = findEndIndex(spaced, content)
		// V8 engine minified the code
		if (index === -1) {
			index = findEndIndex(minified, content)
			matchedLength = minified.length
		}

		if (index === -1) {
			/**
			 * Check if pattern is at the end of the string
			 *
			 * @example
			 * ```typescript
			 * 'const a = body' // true
			 * ```
			 **/
			let lastIndex = content.indexOf(spaced)
			matchedLength = spaced.length
			if (lastIndex === -1) {
				lastIndex = content.indexOf(minified)
				matchedLength = minified.length
			}

			if (lastIndex === -1) break
			if (lastIndex + matchedLength !== content.length) break

			index = lastIndex
		}

		const part = content.slice(0, index)

		let boundary = -1
		for (let i = part.length - 1; i >= 0; i--) {
			const char = part.charCodeAt(i)
			// space , ( ; ) \t \n
			if (
				char === 32 ||
				char === 44 ||
				char === 40 ||
				char === 59 ||
				char === 41 ||
				char === 9 ||
				char === 10
			) {
				boundary = i
				break
			}
		}

		/**
		 * aliased variable last character
		 *
		 * @example
		 * ```typescript
		 * const { hello } = body // } is the last character
		 * ```
		 **/
		const variable = part.slice(boundary + 1)

		// Variable is using object destructuring, find the bracket pair
		if (variable.charCodeAt(variable.length - 1) === 125) {
			const [start, end] = bracketPairRangeReverse(part)

			aliases.push(removeColonAlias(content.slice(start, end)))

			content = content.slice(index + matchedLength)

			continue
		}

		if (variable && !variable.includes('(')) aliases.push(variable)

		content = content.slice(index + matchedLength)
	}

	for (let i = 0; i < aliases.length; i++) {
		const alias = aliases[i]
		if (alias.charCodeAt(0) === 123 || seen.has(alias)) continue

		seen.add(alias)
		aliases.push(...findAlias(alias, body, seen))
	}

	return aliases
}

/**
 * Whitespace as JavaScript defines it, which is what `\s` matches: everything
 * `String.prototype.trim` removes, not just the three characters that happen to
 * appear in LF-formatted source.
 */
const isWhitespace = (char: number) =>
	char === 32 ||
	// \t \n \v \f \r
	(char >= 9 && char <= 13) ||
	// Zs, plus <ZWNBSP> and the two line separators
	char === 160 ||
	char === 5760 ||
	(char >= 8192 && char <= 8202) ||
	char === 8232 ||
	char === 8233 ||
	char === 8239 ||
	char === 8287 ||
	char === 12288 ||
	char === 65279

/**
 * Words that lex as an identifier but are operators, so a `/` after one opens a
 * regex instead of dividing. Padded so a lookup cannot match a substring.
 */
const operatorKeyword =
	' typeof void delete in of instanceof new return case do else yield await throw '

/**
 * Skip a regular expression literal, so a `,`, `}` or quote inside it is not
 * mistaken for structure.
 */
function skipRegexLiteral(parameter: string, start: number, regexEnd: number) {
	let previous = start - 1
	while (previous >= 0 && isWhitespace(parameter.charCodeAt(previous)))
		previous--

	if (previous >= 0) {
		const char = parameter.charCodeAt(previous)

		if (isIdentifierPart(char)) {
			let identifier = previous
			while (
				identifier >= 0 &&
				isIdentifierPart(parameter.charCodeAt(identifier))
			)
				identifier--

			// A member name is never the operator: `x.in / 2` is division.
			// A number ends at its `.` too, and a number is a value
			if (
				parameter.charCodeAt(identifier) === 46 ||
				!operatorKeyword.includes(
					' ' + parameter.slice(identifier + 1, previous + 1) + ' '
				)
			)
				return start
		}
		// ) ] } ' " `
		else if (
			char === 41 ||
			char === 93 ||
			char === 125 ||
			char === 39 ||
			char === 34 ||
			char === 96 ||
			(char === 47 && previous === regexEnd)
		)
			return start
	}

	let inCharacterClass = false
	for (let index = start + 1; index < parameter.length; index++) {
		const char = parameter.charCodeAt(index)

		// Escape
		if (char === 92) index++
		// [
		else if (char === 91) inCharacterClass = true
		// ]
		else if (char === 93) inCharacterClass = false
		// /
		else if (char === 47 && !inCharacterClass) return index
	}

	return start
}

/**
 * Find where a default parameter value ends: the first `,` or `}` that is
 * outside a string or regex literal and not nested inside `()`, `[]`, or `{}`
 *
 * Returns -1 when the value runs until the end of the string
 */
function findDefaultValueEnd(parameter: string, start: number) {
	let deep = 0
	let quote = 0
	// Index of the `/` that closed the last regex literal, see `skipRegexLiteral`
	let regexEnd = -1
	// `deep` of each open `${`, so the `}` that closes an interpolation resumes
	// the template literal instead of being read as structure
	let template: number[] | undefined

	for (let index = start; index < parameter.length; index++) {
		const char = parameter.charCodeAt(index)

		if (quote !== 0) {
			// Escape
			if (char === 92) index++
			else if (char === quote) quote = 0
			// `${` opens an expression inside a template literal
			else if (
				quote === 96 &&
				char === 36 &&
				parameter.charCodeAt(index + 1) === 123
			) {
				;(template ??= []).push(deep)
				quote = 0
				deep++
				index++
			}

			continue
		}

		switch (char) {
			// ' " `
			case 39:
			case 34:
			case 96:
				quote = char
				break

			// /
			case 47: {
				const closing = skipRegexLiteral(parameter, index, regexEnd)
				if (closing !== index) regexEnd = closing
				// eslint-disable-next-line sonarjs/updated-loop-counter
				index = closing
				break
			}

			// ( [ {
			case 40:
			case 91:
			case 123:
				deep++
				break

			// ) ]
			case 41:
			case 93:
				if (deep !== 0) deep--
				break

			// }
			case 125:
				if (deep === 0) return index
				deep--
				// Closes a `${`, so the template literal resumes
				if (
					template !== undefined &&
					template[template.length - 1] === deep
				) {
					template.pop()
					quote = 96
				}
				break

			// ,
			case 44:
				if (deep === 0) return index
				break
		}
	}

	return -1
}

export function removeDefaultParameter(parameter: string) {
	let index = parameter.indexOf('=')

	if (index !== -1) {
		let kept = ''
		let copyFrom = 0

		for (; index < parameter.length; index++) {
			if (parameter.charCodeAt(index) !== 61) continue

			kept += parameter.slice(copyFrom, index)

			const end = findDefaultValueEnd(parameter, index + 1)

			// The value runs to the end of the string, nothing follows it
			if (end === -1) {
				copyFrom = parameter.length

				break
			}

			// `end` is the `,` or `}` that terminates the value, it is structure
			// and has to survive. It is never `=`, so resuming from it is safe
			copyFrom = index = end
		}

		parameter = kept + parameter.slice(copyFrom)
	}

	return parameter
		.split(',')
		.map((i) => i.trim())
		.join(', ')
}

function markAllAccessed(i: Sucrose.Inference) {
	i.query = i.headers = i.body = i.cookie = i.set = i.route = true
	i.afterResponse = true
}

const DEFAULT_CACHE_LIMIT = 1024

type SourceCache = Map<
	number,
	{ content: string; inference: Sucrose.Inference }
>

const globalSourceCache: SourceCache = new Map()

function sourceCache() {
	const session = getCompilerSession()

	return session?.external
		? (session.sucroseCache as SourceCache)
		: globalSourceCache
}

let functionCaches = new WeakMap<Function, Sucrose.Inference>()

function rememberInference(
	caches: SourceCache,
	key: number,
	cached: { content: string; inference: Sucrose.Inference } | undefined,
	content: string,
	event: unknown,
	inference: Sucrose.Inference
) {
	if (!cached || cached.content !== content) {
		if (caches.size >= DEFAULT_CACHE_LIMIT) evictOldestHalf(caches)

		caches.set(key, { content, inference })
	}

	if (typeof event === 'function') functionCaches.set(event, inference)
}

function clearCache() {
	globalSourceCache.clear()
	getCompilerSession()?.sucroseCache.clear()
	functionCaches = new WeakMap()
}

export function clearSucroseCache(delay?: number | null) {
	if (delay === null) return
	clearCache()
}

export const mergeInference = (
	a: Sucrose.Inference,
	b: Sucrose.Inference
): Sucrose.Inference => ({
	body: a.body || b.body,
	cookie: a.cookie || b.cookie,
	headers: a.headers || b.headers,
	query: a.query || b.query,
	set: a.set || b.set,
	route: a.route || b.route,
	...(a.afterResponse || b.afterResponse ? { afterResponse: true } : {})
})

const defaultSucrose = (): Sucrose.Inference => ({
	query: false,
	headers: false,
	body: false,
	cookie: false,
	set: false,
	route: false
})

const emptyInference = Object.freeze(defaultSucrose())

function push(target: unknown[], array: unknown[]) {
	for (let i = 0; i < array.length; i++) target.push(array[i])
}

function pushParse(target: unknown[], array: unknown[]) {
	for (let i = 0; i < array.length; i++)
		if (typeof array[i] === 'function') target.push(array[i])
}

// Single-pass token scanner
interface ScanToken {
	k: 'i' | 's' | 'p'
	value: string
}

const prefixKeywords = new Set([
	'await',
	'case',
	'delete',
	'do',
	'else',
	'in',
	'instanceof',
	'new',
	'of',
	'return',
	'throw',
	'typeof',
	'void',
	'yield'
])

const isIdentifierStart = (char: number) =>
	(char >= 65 && char <= 90) ||
	(char >= 97 && char <= 122) ||
	char === 36 ||
	char === 95 ||
	char >= 128

const isIdentifierPart = (char: number) =>
	isIdentifierStart(char) || (char >= 48 && char <= 57)

function decodeIdentifier(value: string): string | undefined {
	if (!value.includes('\\u')) return value

	let decoded = ''
	for (let i = 0; i < value.length; i++) {
		if (value.charCodeAt(i) !== 92 || value.charCodeAt(i + 1) !== 117) {
			decoded += value[i]
			continue
		}

		i += 2
		let hex: string
		if (value.charCodeAt(i) === 123) {
			const end = value.indexOf('}', i + 1)
			if (end === -1) return
			hex = value.slice(i + 1, end)
			i = end
		} else {
			hex = value.slice(i, i + 4)
			if (hex.length !== 4) return
			i += 3
		}

		const codePoint = Number.parseInt(hex, 16)
		if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return
		decoded += String.fromCodePoint(codePoint)
	}

	return decoded
}

function scanTokens(source: string): ScanToken[] | undefined {
	const tokens: ScanToken[] = []
	let index = 0
	let canEndExpression = false

	const scanCode = (templateExpression = false) => {
		let templateDepth = 0

		while (index < source.length) {
			const char = source.charCodeAt(index)

			if (char === 32 || char === 9 || char === 10 || char === 13) {
				index++
				continue
			}

			if (char === 92 && source.charCodeAt(index + 1) !== 117)
				return false

			if (char === 47) {
				const next = source.charCodeAt(index + 1)
				if (next === 47) {
					index += 2
					while (
						index < source.length &&
						source.charCodeAt(index) !== 10 &&
						source.charCodeAt(index) !== 13
					)
						index++
					continue
				}
				if (next === 42) {
					index += 2
					while (
						index + 1 < source.length &&
						!(
							source.charCodeAt(index) === 42 &&
							source.charCodeAt(index + 1) === 47
						)
					)
						index++
					if (index + 1 >= source.length) return false
					index += 2
					continue
				}

				if (!canEndExpression) {
					index++
					let escaped = false
					let characterClass = false
					let closed = false
					while (index < source.length) {
						const regexChar = source.charCodeAt(index++)
						if (escaped) {
							escaped = false
							continue
						}

						if (regexChar === 92) {
							escaped = true
							continue
						}

						if (regexChar === 91) characterClass = true
						else if (regexChar === 93) characterClass = false
						else if (regexChar === 47 && !characterClass) {
							closed = true
							break
						} else if (regexChar === 10 || regexChar === 13)
							return false
					}

					if (!closed) return false

					while (isIdentifierPart(source.charCodeAt(index))) index++

					canEndExpression = true
					continue
				}

				tokens.push({ k: 'p', value: '/' })
				index++
				canEndExpression = false
				continue
			}

			if (char === 34 || char === 39) {
				const quote = char
				const start = ++index
				let escaped = false

				while (index < source.length) {
					const stringChar = source.charCodeAt(index)
					if (escaped) escaped = false
					else if (stringChar === 92) escaped = true
					else if (stringChar === quote) break
					else if (stringChar === 10 || stringChar === 13)
						return false
					index++
				}

				if (index >= source.length) return false

				tokens.push({
					k: 's',
					value: source.slice(start, index)
				})
				index++
				canEndExpression = true

				continue
			}

			if (char === 96) {
				index++
				let closed = false
				while (index < source.length) {
					const templateChar = source.charCodeAt(index)
					if (templateChar === 92) {
						index += 2
						continue
					}

					if (templateChar === 96) {
						index++
						closed = true
						break
					}

					if (
						templateChar === 36 &&
						source.charCodeAt(index + 1) === 123
					) {
						index += 2
						canEndExpression = false
						if (!scanCode(true)) return false
						continue
					}

					index++
				}

				if (!closed) return false
				canEndExpression = true

				continue
			}

			if (
				isIdentifierStart(char) ||
				(char === 92 && source.charCodeAt(index + 1) === 117)
			) {
				const start = index
				if (char === 92) {
					index += 2
					if (source.charCodeAt(index) === 123) {
						const end = source.indexOf('}', index + 1)
						if (end === -1) return false
						index = end + 1
					} else {
						for (let digit = 0; digit < 4; digit++) {
							const hex = source.charCodeAt(index + digit)
							if (
								!(
									(hex >= 48 && hex <= 57) ||
									(hex >= 65 && hex <= 70) ||
									(hex >= 97 && hex <= 102)
								)
							)
								return false
						}
						index += 4
					}
				} else index++

				while (index < source.length) {
					const identifierChar = source.charCodeAt(index)
					if (isIdentifierPart(identifierChar)) {
						index++
						continue
					}

					if (
						identifierChar === 92 &&
						source.charCodeAt(index + 1) === 117
					) {
						index += 2
						if (source.charCodeAt(index) === 123) {
							const end = source.indexOf('}', index + 1)
							if (end === -1) return false
							index = end + 1
						} else {
							for (let digit = 0; digit < 4; digit++) {
								const hex = source.charCodeAt(index + digit)
								if (
									!(
										(hex >= 48 && hex <= 57) ||
										(hex >= 65 && hex <= 70) ||
										(hex >= 97 && hex <= 102)
									)
								)
									return false
							}
							index += 4
						}
						continue
					}
					break
				}

				const value = decodeIdentifier(source.slice(start, index))
				if (value === undefined) return false

				tokens.push({ k: 'i', value })
				canEndExpression = !prefixKeywords.has(value)

				continue
			}

			if (char >= 48 && char <= 57) {
				index++
				while (isIdentifierPart(source.charCodeAt(index))) index++
				canEndExpression = true
				continue
			}

			if (templateExpression) {
				if (char === 123) templateDepth++
				else if (char === 125) {
					if (templateDepth === 0) {
						index++
						return true
					}
					templateDepth--
				}
			}

			let value = source[index]
			const pair = source.slice(index, index + 2)
			const triple = source.slice(index, index + 3)

			if (triple === '...') value = triple
			else if (
				pair === '?.' ||
				pair === '=>' ||
				pair === '++' ||
				pair === '--'
			)
				value = pair

			tokens.push({ k: 'p', value })
			index += value.length

			if (value !== '++' && value !== '--')
				canEndExpression =
					value === ')' || value === ']' || value === '}'
		}

		return !templateExpression
	}

	return scanCode() ? tokens : undefined
}

const channel = (value: string): keyof Sucrose.Inference | undefined => {
	switch (value) {
		case 'query':
		case 'headers':
		case 'body':
		case 'cookie':
		case 'set':
		case 'route':
			return value
		case 'defer':
			return 'afterResponse'
	}
}

function computedDestructuringChannel(
	tokens: ScanToken[],
	index: number
): false | keyof Sucrose.Inference {
	const property = tokens[index + 1]

	return (
		(property?.k === 's' &&
			!property.value.includes('\\') &&
			tokens[index + 2]?.value === ']' &&
			channel(property.value)) ||
		false
	)
}

function inferFunction(source: string): Sucrose.Inference {
	const inference = defaultSucrose()

	if (
		!source ||
		source.includes('[native code]') ||
		source.trimStart().startsWith('class')
	) {
		markAllAccessed(inference)
		return inference
	}

	let tokens: ScanToken[] | undefined
	try {
		tokens = scanTokens(source)
	} catch {
		markAllAccessed(inference)
		return inference
	}

	if (!tokens?.length) {
		markAllAccessed(inference)
		return inference
	}

	let arrow = -1
	const callableStart = tokens[0].value === 'async' ? 1 : 0
	if (tokens[callableStart]?.value !== 'function') {
		let parentheses = 0
		let brackets = 0
		let braces = 0
		for (let i = callableStart; i < tokens.length; i++) {
			const value = tokens[i].value
			if (value === '(') parentheses++
			else if (value === ')') parentheses--
			else if (value === '[') brackets++
			else if (value === ']') brackets--
			else if (value === '{') {
				if (parentheses === 0 && brackets === 0 && braces === 0) break
				braces++
			} else if (value === '}') braces--
			else if (
				value === '=>' &&
				parentheses === 0 &&
				brackets === 0 &&
				braces === 0
			) {
				arrow = i
				break
			}
		}
	}

	let parameterStart = -1
	let parameterEnd = -1
	let bodyStart = -1
	if (arrow !== -1) {
		bodyStart = arrow + 1
		if (tokens[arrow - 1]?.value === ')') {
			let depth = 1
			for (let i = arrow - 2; i >= 0; i--) {
				if (tokens[i].value === ')') depth++
				else if (tokens[i].value === '(' && --depth === 0) {
					parameterStart = i + 1
					parameterEnd = arrow - 1
					break
				}
			}
		} else {
			parameterStart = arrow - 1
			parameterEnd = arrow
		}
	} else {
		for (let i = 0; i < tokens.length; i++)
			if (tokens[i].value === '(') {
				parameterStart = i + 1
				let depth = 1
				for (let j = i + 1; j < tokens.length; j++) {
					if (tokens[j].value === '(') depth++
					else if (tokens[j].value === ')' && --depth === 0) {
						parameterEnd = j
						bodyStart = j + 1
						break
					}
				}
				break
			}
	}

	if (parameterStart < 0 || parameterEnd < parameterStart || bodyStart < 0) {
		markAllAccessed(inference)
		return inference
	}

	const aliases = new Set<string>()
	const first = tokens[parameterStart]
	if (parameterStart === parameterEnd) {
		// A zero-parameter handler cannot name the context except through
		// `arguments`, which is handled conservatively in the body scan
	} else if (first?.k === 'i') aliases.add(first.value)
	else if (first?.value === '{') {
		let depth = 0
		for (let i = parameterStart; i < parameterEnd; i++) {
			const token = tokens[i]
			if (token.value === '{') depth++
			else if (token.value === '}') depth--
			// later parameters (message body, close code) never carry the context
			else if (token.value === ',' && depth === 0) break
			else if (
				token.value === '[' &&
				depth === 1 &&
				(tokens[i - 1]?.value === '{' || tokens[i - 1]?.value === ',')
			) {
				const computed = computedDestructuringChannel(tokens, i)
				if (computed === false) {
					markAllAccessed(inference)
					return inference
				}
				if (computed) inference[computed] = true
			} else if (token.value === '...' && depth === 1) {
				const rest = tokens[i + 1]
				if (rest?.k === 'i') aliases.add(rest.value)
			} else if (token.k === 'i' && depth === 1) {
				// `ws` is the WS context's self-reference: `({ ws })` binds
				// the whole context, so channels read through it must count
				if (
					token.value === 'ws' &&
					(tokens[i - 1]?.value === '{' ||
						tokens[i - 1]?.value === ',')
				) {
					const renamed =
						tokens[i + 1]?.value === ':' &&
						tokens[i + 2]?.k === 'i'
							? tokens[i + 2].value
							: token.value
					aliases.add(renamed)
					continue
				}

				const key = channel(token.value)
				if (key) inference[key] = true
			}
		}
	} else {
		markAllAccessed(inference)
		return inference
	}

	type Pattern = [
		channels: Set<false | keyof Sucrose.Inference>,
		rest?: string
	]

	const patterns: Pattern[] = []
	let closedPattern: Pattern | undefined

	for (let i = bodyStart; i < tokens.length; i++) {
		const token = tokens[i]
		if (token.value === '{') {
			patterns.push([new Set()])
			closedPattern = undefined
			continue
		}

		if (token.value === '}') {
			closedPattern = patterns.pop()
			continue
		}

		if (patterns.length) {
			const current = patterns[patterns.length - 1]
			if (
				token.value === '[' &&
				(tokens[i - 1]?.value === '{' || tokens[i - 1]?.value === ',')
			) {
				const computed = computedDestructuringChannel(tokens, i)
				current[0].add(computed)
			} else if (token.value === '...' && tokens[i + 1]?.k === 'i')
				current[1] = tokens[i + 1].value
			else if (token.k === 'i') {
				const key = channel(token.value)
				if (key) current[0].add(key)
			}
		}

		if (token.value === '=') {
			const right = tokens[i + 1]
			let member = i + 2
			if (tokens[member]?.value === '?.') member++
			if (
				right?.k === 'i' &&
				aliases.has(right.value) &&
				tokens[member]?.value !== '.' &&
				tokens[member]?.value !== '[' &&
				tokens[member]?.k !== 'i'
			) {
				const left = tokens[i - 1]
				if (left?.k === 'i') aliases.add(left.value)
				else if (left?.value === '}' && closedPattern) {
					for (const key of closedPattern[0]) {
						if (key === false) {
							markAllAccessed(inference)
							return inference
						}
						inference[key] = true
					}
					if (closedPattern[1]) aliases.add(closedPattern[1])
				}
			}

			continue
		}

		if (token.k !== 'i') continue
		if (token.value === 'arguments' || token.value === 'eval') {
			markAllAccessed(inference)
			break
		}
		if (!aliases.has(token.value)) continue

		let next = i + 1
		if (tokens[next]?.value === '?.') next++
		if (tokens[next]?.value === '.') next++

		if (tokens[next]?.k === 'i' && next > i + 1) {
			const key = channel(tokens[next].value)
			if (key) inference[key] = true
			continue
		}

		if (tokens[next]?.value === '[') {
			const property = tokens[next + 1]
			const key = property?.k === 's' && channel(property.value)

			if (key && tokens[next + 2]?.value === ']') inference[key] = true
			else markAllAccessed(inference)

			if (
				inference.query &&
				inference.headers &&
				inference.body &&
				inference.cookie &&
				inference.set &&
				inference.route &&
				inference.afterResponse
			)
				break

			continue
		}

		if (
			tokens[i - 1]?.value === '=' &&
			(tokens[i - 2]?.k === 'i' || tokens[i - 2]?.value === '}')
		)
			continue

		markAllAccessed(inference)
		break
	}

	return inference
}

// Reuse buffer instead of reallocated per call
const eventsBuffer: Handler[] = []
let eventsBufferInUse = false

export function sucrose(
	handler: Handler | undefined,
	lifeCycle: Sucrose.LifeCycle | undefined
): Sucrose.Inference {
	let inference: Sucrose.Inference | undefined
	let merged = false

	const reentrant = eventsBufferInUse
	const events: Handler[] = reentrant ? [] : eventsBuffer
	eventsBufferInUse = true

	try {
		if (handler && typeof handler === 'function') events.push(handler)
		if (lifeCycle) {
			if (lifeCycle.request?.length) push(events, lifeCycle.request)

			if (lifeCycle.beforeHandle?.length)
				push(events, lifeCycle.beforeHandle)

			if (lifeCycle.parse?.length) pushParse(events, lifeCycle.parse)
			if (lifeCycle.error?.length) push(events, lifeCycle.error)
			if (lifeCycle.transform?.length) push(events, lifeCycle.transform)

			if (lifeCycle.afterHandle?.length)
				push(events, lifeCycle.afterHandle)

			if (lifeCycle.mapResponse?.length)
				push(events, lifeCycle.mapResponse)

			if (lifeCycle.afterResponse?.length)
				push(events, lifeCycle.afterResponse)
		}

		const caches = sourceCache()

		for (let i = 0; i < events.length; i++) {
			const event = events[i]
			if (!event) continue

			let inferred = functionCaches.get(event as Function)
			if (!inferred) {
				if (
					typeof event === 'function' &&
					Object.hasOwn(event, 'toString')
				) {
					// An own `toString` is a forged source: the real behavior
					// cannot be trusted from it, so widen every channel and memo
					// by identity only, never by content
					const forged = defaultSucrose()
					markAllAccessed(forged)

					inferred = Object.freeze(forged)
					functionCaches.set(event, inferred)
				} else {
					const content = event.toString()
					const key = fnv1a(content)
					const cached = caches.get(key)

					if (cached && cached.content === content) {
						inferred = cached.inference
						if (caches.size >= DEFAULT_CACHE_LIMIT) {
							caches.delete(key)
							caches.set(key, cached)
						}

						if (typeof event === 'function')
							functionCaches.set(event, inferred)
					} else {
						inferred = Object.freeze(inferFunction(content))
						rememberInference(
							caches,
							key,
							cached,
							content,
							event,
							inferred
						)
					}
				}
			}

			if (inference) {
				inference = mergeInference(inference, inferred)
				merged = true
			} else inference = inferred

			if (
				inference.query &&
				inference.headers &&
				inference.body &&
				inference.cookie &&
				inference.set &&
				inference.route &&
				inference.afterResponse
			)
				break
		}
	} finally {
		events.length = 0
		eventsBufferInUse = reentrant
	}

	// every `inferred` is already frozen, so a single-event result is returned as-is
	// Only new allocations still need sealing
	if (!inference) return emptyInference

	return merged ? Object.freeze(inference) : inference
}
