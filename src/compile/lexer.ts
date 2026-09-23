// Returns the index just past the closing quote
export function skipString(src: string, start: number): number {
	const quote = src[start]
	let i = start + 1

	if (quote === '`') {
		while (i < src.length) {
			const ch = src[i]
			if (ch === '\\') {
				i += 2
				continue
			}

			if (ch === '`') return i + 1
			if (ch === '$' && src[i + 1] === '{') {
				// skip balanced `${ ... }`
				let depth = 1
				i += 2

				while (i < src.length && depth > 0) {
					const c = src[i]
					if (c === '"' || c === "'" || c === '`') {
						i = skipString(src, i)
						continue
					}

					if (c === '{') depth++
					else if (c === '}') depth--

					i++
				}

				continue
			}

			i++
		}

		return i
	}

	while (i < src.length) {
		const ch = src[i]
		if (ch === '\\') {
			i += 2
			continue
		}

		if (ch === quote) return i + 1
		i++
	}

	return i
}

// Single-pass token scanner, shared by sucrose and derive key extraction
export interface ScanToken {
	k: 'i' | 's' | 'p'
	value: string
	// source offset of the token's first character (a string's opening quote)
	at: number
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

// JS `\s` is exactly WhiteSpace + LineTerminator, NBSP / BOM / U+2028 included
const isSpace = (char: number) =>
	char === 32 ||
	(char >= 9 && char <= 13) ||
	(char >= 128 && /\s/.test(String.fromCharCode(char)))

const isIdentifierStart = (char: number) =>
	(char >= 65 && char <= 90) ||
	(char >= 97 && char <= 122) ||
	char === 36 ||
	char === 95 ||
	(char >= 128 && !isSpace(char))

const isIdentifierPart = (char: number) =>
	isIdentifierStart(char) || (char >= 48 && char <= 57)

// whether a `(` opens an `if` / `while` / `for` / `with` header. Kept out of
// scanTokens and never reading a negative index: either makes JSC run the
// whole scan loop on a slow path
function isHeader(tokens: ScanToken[]) {
	let keyword = tokens.length - 1
	// `for await (`
	if (
		keyword > 0 &&
		tokens[keyword].value === 'await' &&
		tokens[keyword - 1].value === 'for'
	)
		keyword--
	if (keyword < 0) return false

	const { k, value: v } = tokens[keyword]
	if (
		k !== 'i' ||
		(v !== 'if' && v !== 'while' && v !== 'for' && v !== 'with')
	)
		return false

	if (keyword === 0) return true

	// but not the property `x.if(`
	const before = tokens[keyword - 1]
	return !(
		before.k === 'p' &&
		(before.value === '.' || before.value === '?.' || before.value === '#')
	)
}

export function scanTokens(source: string): ScanToken[] | undefined {
	const tokens: ScanToken[] = []
	let index = 0
	let canEndExpression = false

	const headers: boolean[] = []

	// skips `\u{…}` / `\uXXXX` escape at `index`
	const skipUnicodeEscape = () => {
		index += 2
		if (source.charCodeAt(index) === 123) {
			const end = source.indexOf('}', index + 1)
			if (end === -1) return false
			index = end + 1

			return true
		}

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

		return true
	}

	const scanCode = (templateExpression = false) => {
		let templateDepth = 0

		while (index < source.length) {
			const char = source.charCodeAt(index)

			if (isSpace(char)) {
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
						source.charCodeAt(index) !== 13 &&
						source.charCodeAt(index) !== 0x2028 &&
						source.charCodeAt(index) !== 0x2029
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
					// `of` / `await` / `yield` may be plain identifiers, so
					// `of / 2` may be a division: unprovable
					const previous = tokens.length
						? tokens[tokens.length - 1]
						: undefined
					if (
						previous?.k === 'i' &&
						(previous.value === 'of' ||
							previous.value === 'await' ||
							previous.value === 'yield')
					)
						return false

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

				// after a block `}` a `/` starts a regex, after an object
				// literal it divides: unprovable
				const previous = tokens.length
					? tokens[tokens.length - 1]
					: undefined
				if (previous?.k === 'p' && previous.value === '}') return false

				tokens.push({ k: 'p', value: '/', at: index })
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
					value: source.slice(start, index),
					at: start - 1
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
					if (!skipUnicodeEscape()) return false
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
						if (!skipUnicodeEscape()) return false
						continue
					}
					break
				}

				const identifierText = source.slice(start, index)
				let value: string | undefined
				if (!identifierText.includes('\\u')) {
					value = identifierText
				} else {
					let decoded = ''
					let failed = false
					for (let i = 0; i < identifierText.length; i++) {
						if (
							identifierText.charCodeAt(i) !== 92 ||
							identifierText.charCodeAt(i + 1) !== 117
						) {
							decoded += identifierText[i]
							continue
						}

						i += 2
						let hex: string
						if (identifierText.charCodeAt(i) === 123) {
							const end = identifierText.indexOf('}', i + 1)
							if (end === -1) {
								failed = true
								break
							}
							hex = identifierText.slice(i + 1, end)
							// eslint-disable-next-line sonarjs/updated-loop-counter -- scanner resumes past the consumed escape
							i = end
						} else {
							hex = identifierText.slice(i, i + 4)
							if (hex.length !== 4) {
								failed = true
								break
							}
							i += 3
						}

						const codePoint = Number.parseInt(hex, 16)
						if (
							!Number.isFinite(codePoint) ||
							codePoint > 0x10ffff
						) {
							failed = true
							break
						}
						decoded += String.fromCodePoint(codePoint)
					}

					value = failed ? undefined : decoded
				}
				if (value === undefined) return false

				// a keyword after `.` / `?.` / `#` is a property name:
				// `x.in / 2`, `this.#in / 2`
				canEndExpression = !prefixKeywords.has(value)
				if (!canEndExpression && tokens.length) {
					const previous = tokens[tokens.length - 1]
					canEndExpression =
						previous.k === 'p' &&
						(previous.value === '.' ||
							previous.value === '?.' ||
							previous.value === '#')
				}
				tokens.push({ k: 'i', value, at: start })

				continue
			}

			// `.5` is a number, not a `.` that makes the next keyword a
			// property name: `x = .5 \n return /a*/`
			const leadingDot =
				char === 46 &&
				source.charCodeAt(index + 1) >= 48 &&
				source.charCodeAt(index + 1) <= 57
			if ((char >= 48 && char <= 57) || leadingDot) {
				index++
				while (isIdentifierPart(source.charCodeAt(index))) index++
				// the fraction, so `1./2` stays a division
				if (!leadingDot && source.charCodeAt(index) === 46) {
					index++
					while (isIdentifierPart(source.charCodeAt(index))) index++
				}
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

			if (value === '(') headers.push(isHeader(tokens))

			tokens.push({ k: 'p', value, at: index })
			index += value.length

			if (value !== '++' && value !== '--')
				canEndExpression =
					(value === ')' && !headers.pop()) ||
					value === ']' ||
					value === '}'
		}

		return !templateExpression
	}

	return scanCode() ? tokens : undefined
}
