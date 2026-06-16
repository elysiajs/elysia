import { describe, it, expect } from 'bun:test'
import { defaultWSParse, createMessageParser } from '../../src/ws'

describe('defaultWSParse', () => {
	// F32: '/' (charCode 47) was sniffed as a JSON prefix, paying a
	// guaranteed-throw JSON.parse per '/'-message. Removing it must not
	// change ANY output — '/'-prefixed strings can never parse as JSON,
	// so catch-return and fall-through are observably identical.
	it('F32: output is unchanged across the prefix corpus', () => {
		const corpus: [input: string, expected: unknown][] = [
			['/', '/'],
			['/join x', '/join x'],
			['/123', '/123'],
			['//', '//'],
			['/{"a":1}', '/{"a":1}'],
			['{"a":1}', { a: 1 }],
			['[1]', [1]],
			['"s"', 's'],
			['-5', -5],
			['true', true]
		]

		for (const [input, expected] of corpus)
			expect(defaultWSParse(input)).toEqual(expected as any)
	})

	it('non-string frames pass through untouched', () => {
		const buf = Buffer.from('{"a":1}')
		expect(defaultWSParse(buf)).toBe(buf)
	})
})

describe('createMessageParser', () => {
	const fakeWS = {} as any

	// F6: the zero-parser variant must be fully sync — a Promise per
	// inbound frame was pure engine overhead on the hottest WS path.
	it('F6: zero-parser variant returns sync (no Promise per message)', () => {
		const parse = createMessageParser(undefined)

		const result = parse(fakeWS, '{"a":1}')
		expect(result instanceof Promise).toBe(false)
		expect(result).toEqual({ a: 1 })

		expect(parse(fakeWS, '/join x')).toBe('/join x')
	})

	it('F6: fully-sync parser chain returns sync, applied in order', () => {
		const parse = createMessageParser([
			(_ws, message) => `${message}-1`,
			// returning undefined keeps the previous value
			() => undefined,
			(_ws, message) => `${message}-2`
		])

		const result = parse(fakeWS, 'x')
		expect(result instanceof Promise).toBe(false)
		expect(result).toBe('x-1-2')
	})

	it('F6: async parser switches to a Promise, resuming the chain in order', async () => {
		const parse = createMessageParser([
			(_ws, message) => `${message}-sync`,
			async (_ws, message) => `${message}-async`,
			(_ws, message) => `${message}-tail`
		])

		const result = parse(fakeWS, 'x')
		expect(result instanceof Promise).toBe(true)
		expect(await result).toBe('x-sync-async-tail')
	})

	it('F6: sync parser throw propagates synchronously to the caller', () => {
		const parse = createMessageParser([
			() => {
				throw new Error('boom')
			}
		])

		// dispatchMessage's try/catch routes this to handleError — the
		// throw must stay synchronous, not become a rejected Promise.
		expect(() => parse(fakeWS, 'x')).toThrow('boom')
	})
})
