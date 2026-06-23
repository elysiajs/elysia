import { describe, expect, it } from 'bun:test'

import { parseQueryFromURL } from '../../src/parse-query'

const parse = (url: string) => parseQueryFromURL(url, url.indexOf('?'))

describe('parseQueryFromURL', () => {
	it('parses a simple query', () => {
		expect(parse('http://x.ab/path?a=1&b=2')).toEqual({ a: '1', b: '2' })
	})

	it('decodes percent-encoded and plus values', () => {
		expect(parse('http://x.ab/path?q=hello+world&e=a%20b')).toEqual({
			q: 'hello world',
			e: 'a b'
		})
	})

	// Regression (audit H14): the scanner started at index 0 and walked the
	// whole URL, so a literal '&' in the matched path (a legal pchar, reachable
	// via `/:param`) reset parser state INTO the path and corrupted the query.
	// '%'/'+'/'=' in the path also set stale decode flags. Scanning must start
	// after the '?'.
	it('ignores delimiters in the path before the query', () => {
		expect(parse('http://x.ab/files/a&b?name=value&x=1')).toEqual({
			name: 'value',
			x: '1'
		})

		expect(parse('http://x.ab/p+a%20th?q=hello+world')).toEqual({
			q: 'hello world'
		})

		// '=' in the path must not be mistaken for the first key/value split
		expect(parse('http://x.ab/a=b/c?k=v')).toEqual({ k: 'v' })
	})

	it('returns empty object when there is no query string', () => {
		expect(parse('http://x.ab/no-query')).toEqual({})
		expect(parse('http://x.ab/trailing?')).toEqual({})
	})

	// Regression (audit P6): a malformed bracketed value on an array+object
	// field hit an UNGUARDED JSON.parse (the other parse sites were guarded),
	// throwing an uncaught error → a request-controlled 500. It must fall back
	// gracefully instead of throwing.
	it('does not throw on malformed bracketed array+object input', () => {
		const url = 'http://x.ab/p?key=[not-json'
		const cfg = { key: 1 as const }

		expect(() =>
			parseQueryFromURL(url, url.indexOf('?'), cfg, cfg)
		).not.toThrow()

		// valid JSON array still parses on that path
		const ok = 'http://x.ab/p?key=[1,2]'
		expect(
			parseQueryFromURL(ok, ok.indexOf('?'), cfg, cfg).key as unknown
		).toEqual([1, 2])
	})

	it('preserves repeated bracketed array query order', () => {
		// The repeated-array path appends into an existing array. This guards the
		// no-spread push loop so an allocation cleanup cannot reorder values.
		const cfg = { key: 1 as const }

		expect(
			parseQueryFromURL(
				'http://x.ab/p?key=[1,2]&key=[3,4]',
				'http://x.ab/p'.length,
				cfg
			).key as unknown
		).toEqual(['1', '2', '3', '4'])
	})
})
