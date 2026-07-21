// Parse hooks receive the per-message ElysiaWS view (matching the declared
// `WSParseHandler` type), passed through opaquely here.

function isNumericString(s: string) {
	if (s.length === 0) return false

	let sawDigit = false
	let sawDot = false

	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)

		if (i === 0 && (c === 43 || c === 45)) continue
		if (c >= 48 && c <= 57) {
			sawDigit = true
			continue
		}

		if (c === 46 && !sawDot) {
			sawDot = true
			continue
		}

		return false
	}

	return sawDigit
}

export function defaultWSParse(message: string | Buffer | Uint8Array): unknown {
	if (typeof message !== 'string') return message

	const start = message.charCodeAt(0)
	const letter = start | 32
	if (
		letter >= 97 &&
		letter <= 122 &&
		letter !== 102 &&
		letter !== 110 &&
		letter !== 116
	)
		return message

	if (start === 34 || start === 91 || start === 123) {
		try {
			return JSON.parse(message)
		} catch {
			return message
		}
	}
	if (
		(start < 48 || start > 57) &&
		start !== 43 &&
		start !== 45 &&
		start !== 46
	) {
		if (start === 116 && message === 'true') return true
		if (start === 102 && message === 'false') return false
		if (start === 110 && message === 'null') return null

		return message
	}

	if (isNumericString(message)) {
		// Don't coerce values that would lose precision (Snowflakes, long IDs):
		// <16 chars is always safe; a 16-char value only if it round-trips.
		if (message.length < 16) return +message

		const n = +message
		if (message.length === 16 && String(n) === message) return n

		return message
	}
	return message
}

export function createMessageParser(
	parsers:
		| Array<(ws: any, message: unknown) => unknown | Promise<unknown>>
		| undefined
) {
	if (!parsers || parsers.length === 0)
		return function parse(_ws: unknown, rawMessage: string | Buffer) {
			return defaultWSParse(rawMessage)
		}

	// Resume the parser chain from `next` after the first Promise.
	async function parseAsync(
		ws: unknown,
		pending: Promise<unknown>,
		value: unknown,
		next: number
	) {
		const resolved = await pending
		if (resolved !== undefined) value = resolved

		for (let i = next; i < parsers!.length; i++) {
			let r = parsers![i](ws, value)
			if (r instanceof Promise) r = await r
			if (r !== undefined) value = r
		}

		return value
	}

	return function parse(ws: unknown, rawMessage: string | Buffer) {
		let value = defaultWSParse(rawMessage)

		for (let i = 0; i < parsers.length; i++) {
			const r = parsers[i](ws, value)
			if (r instanceof Promise) return parseAsync(ws, r, value, i + 1)
			if (r !== undefined) value = r
		}

		return value
	}
}
