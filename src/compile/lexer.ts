export const isSpace = (ch: string) =>
	ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r'

export const isIdentChar = (ch: string) =>
	(ch >= 'a' && ch <= 'z') ||
	(ch >= 'A' && ch <= 'Z') ||
	(ch >= '0' && ch <= '9') ||
	ch === '_' ||
	ch === '$'

export const isIdentCharCode = (code: number) =>
	(code >= 97 && code <= 122) || // a-z
	(code >= 65 && code <= 90) || // A-Z
	(code >= 48 && code <= 57) || // 0-9
	code === 95 || // _
	code === 36 // $

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
