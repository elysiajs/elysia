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

	it('ignores delimiters in the path before the query', () => {
		expect(parse('http://x.ab/files/a&b?name=value&x=1')).toEqual({
			name: 'value',
			x: '1'
		})

		expect(parse('http://x.ab/p+a%20th?q=hello+world')).toEqual({
			q: 'hello world'
		})

		expect(parse('http://x.ab/a=b/c?k=v')).toEqual({ k: 'v' })
	})

	it('returns empty object when there is no query string', () => {
		expect(parse('http://x.ab/no-query')).toEqual({})
		expect(parse('http://x.ab/trailing?')).toEqual({})
	})

	it('does not throw on malformed bracketed array+object input', () => {
		const url = 'http://x.ab/p?key=[not-json'
		const cfg = { key: 1 as const }

		expect(() =>
			parseQueryFromURL(url, url.indexOf('?'), cfg, cfg)
		).not.toThrow()

		const ok = 'http://x.ab/p?key=[1,2]'
		expect(
			parseQueryFromURL(ok, ok.indexOf('?'), cfg, cfg).key as unknown
		).toEqual([1, 2])
	})

	it('does not treat an unclosed bracket value as an array', () => {
		const cfg = { role: 1 as const }
		const url = 'http://x.ab/p?role=[adminX'

		expect(parseQueryFromURL(url, url.indexOf('?'), cfg).role).toEqual([
			'[adminX'
		])

		const ok = 'http://x.ab/p?role=[admin]'
		expect(parseQueryFromURL(ok, ok.indexOf('?'), cfg).role).toEqual([
			'admin'
		])

		const plain = 'http://x.ab/p?role=[adminX'
		expect(parseQueryFromURL(plain, plain.indexOf('?')).role).toBe(
			'[adminX'
		)
	})

	it('preserves repeated bracketed array query order', () => {
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
