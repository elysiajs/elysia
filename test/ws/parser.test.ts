import { describe, it, expect } from 'bun:test'
import { defaultWSParse, createMessageParser } from '../../src/ws'

describe('defaultWSParse', () => {
	it('parses supported literals without treating slash-prefixed strings as JSON', () => {
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

	it('returns synchronously when no custom parsers are registered', () => {
		const parse = createMessageParser(undefined)

		const result = parse(fakeWS, '{"a":1}')
		expect(result instanceof Promise).toBe(false)
		expect(result).toEqual({ a: 1 })

		expect(parse(fakeWS, '/join x')).toBe('/join x')
	})

	it('applies synchronous parsers in order without returning a Promise', () => {
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

	it('returns a Promise and resumes remaining parsers in order', async () => {
		const parse = createMessageParser([
			(_ws, message) => `${message}-sync`,
			async (_ws, message) => `${message}-async`,
			(_ws, message) => `${message}-tail`
		])

		const result = parse(fakeWS, 'x')
		expect(result instanceof Promise).toBe(true)
		await expect(result).resolves.toBe('x-sync-async-tail')
	})

	it('throws synchronously when a parser throws', () => {
		const parse = createMessageParser([
			() => {
				throw new Error('boom')
			}
		])

		expect(() => parse(fakeWS, 'x')).toThrow('boom')
	})
})
