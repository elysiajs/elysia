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

	let i = start === 43 || start === 45 ? 1 : 0
	let sawDigit = false
	let sawDot = false

	for (; i < message.length; i++) {
		const c = message.charCodeAt(i)

		if (c >= 48 && c <= 57) sawDigit = true
		else if (c === 46 && !sawDot) sawDot = true
		else break
	}

	if (sawDigit && i === message.length) {
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
