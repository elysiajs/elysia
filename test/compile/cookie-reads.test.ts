import { describe, expect, it } from 'bun:test'

import { analyzeCookieReads } from '../../src/compile/handler/cookie-reads'
import type { Sucrose } from '../../src/sucrose'

// The cookie-read analyzer performs a conservative static extraction of the
// cookie names a route's pipeline reads. Only provably-static patterns produce
// names; anything the analyzer cannot prove closed collapses to `undefined`.
// False "analyzable" claims are security-relevant (the lazy signed-cookie
// verify path will consume this), so `undefined` must always be the answer for
// unanalyzable shapes — these tests pin both directions.

const cookieInference: Sucrose.Inference = {
	query: false,
	headers: false,
	body: false,
	cookie: true,
	set: false,
	server: false,
	route: false,
	url: false,
	path: false
}

const noCookieInference: Sucrose.Inference = {
	...cookieInference,
	cookie: false
}

const analyze = (
	fn: unknown,
	inference: Sucrose.Inference = cookieInference,
	hasCookieValidator = false
) => analyzeCookieReads(fn, undefined, inference, hasCookieValidator)

describe('cookie-read analyzer — analyzable patterns yield names', () => {
	it('jar shorthand destructuring + member access', () => {
		expect(analyze(({ cookie }: any) => cookie.session.value)).toEqual([
			'session'
		])
	})

	it('context alias member chain', () => {
		expect(analyze((c: any) => c.cookie.token.value)).toEqual(['token'])
	})

	it('nested cookie destructuring', () => {
		expect(
			analyze(({ cookie: { a, b } }: any) => a.value + b.value)
		).toEqual(['a', 'b'])
	})

	it('literal string index', () => {
		expect(analyze(({ cookie }: any) => cookie['sid'].value)).toEqual([
			'sid'
		])
	})

	it('renamed jar alias', () => {
		expect(analyze(({ cookie: jar }: any) => jar.z.value)).toEqual(['z'])
	})

	it('multiple distinct reads are collected and sorted', () => {
		expect(
			analyze(({ cookie }: any) => cookie.b.value + cookie.a.value)
		).toEqual(['a', 'b'])
	})

	it('destructured key with default', () => {
		expect(analyze(({ cookie: { a = 1 } }: any) => a)).toEqual(['a'])
	})

	it('optional chaining on the jar', () => {
		expect(analyze(({ cookie }: any) => cookie?.sid?.value)).toEqual([
			'sid'
		])
	})

	it('optional chaining on the context alias', () => {
		expect(analyze((c: any) => c?.cookie?.token?.value)).toEqual(['token'])
	})

	it('a set-only write still exposes the read name', () => {
		expect(
			analyze(({ cookie }: any) => {
				cookie.foo.value = 'x'
				return 'ok'
			})
		).toEqual(['foo'])
	})

	it('block bodies ignore identifier prefixes around the context alias', () => {
		const fn = Function(
			'return function(c){const value=c.cookie.token.value;return value}'
		)()
		expect(analyze(fn)).toEqual(['token'])
	})

	it('longer identifiers do not escape a destructured jar alias', () => {
		const fn = Function(
			'return function({cookie}){const cookieString="x";return cookie.sid.value}'
		)()
		expect(analyze(fn)).toEqual(['sid'])
	})

	it('method shorthand normalizes its parenthesized destructuring parameter', () => {
		const object = {
			handler({ cookie }: any) {
				const value = cookie.sid.value
				return value
			}
		}
		expect(analyze(object.handler)).toEqual(['sid'])
	})
})

describe('cookie-read analyzer — unanalyzable patterns yield undefined', () => {
	it('Object.keys over the jar (enumeration)', () => {
		expect(
			analyze(({ cookie }: any) => Object.keys(cookie))
		).toBeUndefined()
	})

	it('the jar passed to a call', () => {
		expect(
			analyze(({ cookie }: any) => JSON.stringify(cookie))
		).toBeUndefined()
	})

	it('the jar spread', () => {
		expect(analyze(({ cookie }: any) => ({ ...cookie }))).toBeUndefined()
	})

	it('the jar aliased into a local binding', () => {
		expect(
			analyze(({ cookie }: any) => {
				const jar = cookie
				return jar
			})
		).toBeUndefined()
	})

	it('a nested computed-key destructure', () => {
		expect(analyze(({ cookie: { ['x']: y } }: any) => y)).toBeUndefined()
	})

	it('a computed root key can alias the cookie jar', () => {
		const fn = Function(
			"return function({['coo'+'kie']:jar}){return jar.sid.value}"
		)()
		expect(analyze(fn)).toBeUndefined()
	})

	it('the context-alias jar enumerated', () => {
		expect(analyze((c: any) => Object.keys(c.cookie))).toBeUndefined()
	})

	it('the context destructured inside the body', () => {
		expect(
			analyze((c: any) => {
				const { cookie } = c
				return cookie.sid.value
			})
		).toBeUndefined()
	})

	it('the context aliased inside the body', () => {
		const fn = Function(
			'return function(c){const alias=c;return alias.cookie.sid.value}'
		)()
		expect(analyze(fn)).toBeUndefined()
	})

	it('the context passed to another function', () => {
		const helper = (c: any) => c.cookie.sid.value
		expect(analyze((c: any) => helper(c))).toBeUndefined()
	})
})

describe('cookie-read analyzer — no cookie usage yields []', () => {
	it('no cookie channel and no validator', () => {
		expect(
			analyze(({ query }: any) => query.x, noCookieInference, false)
		).toEqual([])
	})

	it('cookie channel inferred but never accessed statically', () => {
		expect(analyze(() => 'ok', cookieInference, false)).toEqual([])
	})

	it('a cookie validator present but the handler reads nothing', () => {
		expect(analyze(() => 'ok', noCookieInference, true)).toEqual([])
	})
})

describe('cookie-read analyzer — lifecycle functions are all scanned', () => {
	it('merges reads across handler and lifecycle hooks', () => {
		const result = analyzeCookieReads(
			({ cookie }: any) => cookie.a.value,
			{
				beforeHandle: [({ cookie }: any) => cookie.b.value],
				afterHandle: (c: any) => c.cookie.c.value
			} as any,
			cookieInference,
			false
		)

		expect(result).toEqual(['a', 'b', 'c'])
	})

	it('one unanalyzable lifecycle function collapses the whole route', () => {
		const result = analyzeCookieReads(
			({ cookie }: any) => cookie.a.value,
			{
				beforeHandle: [({ cookie }: any) => Object.keys(cookie)]
			} as any,
			cookieInference,
			false
		)

		expect(result).toBeUndefined()
	})
})
