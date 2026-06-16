import type { ServerWebSocket } from './types'
import type { WSConnectionData } from './context'

function isNumericString(s: string): boolean {
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

	if (start === 34 || start === 91 || start === 123) {
		try {
			return JSON.parse(message)
		} catch {
			return message
		}
	}

	if (isNumericString(message)) return +message
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
			_ws: ServerWebSocket<WSConnectionData>,
			rawMessage: string | Buffer
		) {
			return defaultWSParse(rawMessage)
		}

	// Resume the parser chain from `next` after the first Promise.
	async function parseAsync(
		ws: ServerWebSocket<WSConnectionData>,
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
		ws: ServerWebSocket<WSConnectionData>,
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
