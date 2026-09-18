// Parse hooks receive the per-message ElysiaWS view (matching the declared
// `WSParseHandler` type), passed through opaquely here.

export function defaultWSParse(message: string | Buffer | Uint8Array): unknown {
	if (typeof message !== 'string') return message

	const start = message.charCodeAt(0)

	if (start === 34 || start === 91 || start === 123) {
		try {
			return JSON.parse(message)
		} catch {
			return message
		}
	}

	let isNumeric: boolean
	if (message.length === 0) {
		isNumeric = false
	} else {
		let sawDigit = false
		let sawDot = false
		let invalid = false

		for (let i = 0; i < message.length; i++) {
			const c = message.charCodeAt(i)

			if (i === 0 && (c === 43 || c === 45)) continue
			if (c >= 48 && c <= 57) {
				sawDigit = true
				continue
			}

			if (c === 46 && !sawDot) {
				sawDot = true
				continue
			}

			invalid = true
			break
		}

		isNumeric = invalid ? false : sawDigit
	}

	if (isNumeric) {
		// Don't coerce values that would lose precision (Snowflakes, long IDs):
		// <16 chars is always safe; a 16-char value only if it round-trips.
		if (message.length < 16) return +message

		const n = +message
		if (message.length === 16 && String(n) === message) return n

		return message
	}
	if (message === 'true') return true
	if (message === 'false') return false
	if (message === 'null') return null

	return message
}

export function createMessageParser(
	parsers:
		| Array<(ws: any, message: unknown) => unknown | Promise<unknown>>
		| undefined
) {
	if (!parsers || parsers.length === 0)
		return function parse(
			_ws: unknown,
			rawMessage: string | Buffer
		) {
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

	return function parse(
		ws: unknown,
		rawMessage: string | Buffer
	) {
		let value = defaultWSParse(rawMessage)

		for (let i = 0; i < parsers.length; i++) {
			const r = parsers[i](ws, value)
			if (r instanceof Promise) return parseAsync(ws, r, value, i + 1)
			if (r !== undefined) value = r
		}

		return value
	}
}
