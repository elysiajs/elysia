import { describe, expect, it } from 'bun:test'
import { parseCookie, Cookie, signCookie, unsignCookie } from '../../src/cookie'

describe('Parse Cookie', () => {
	it('handle empty cookie', async () => {
		const set = {
			headers: {},
			cookie: {}
		}
		const cookieString = ''
		const result = await parseCookie(set, cookieString)

		expect(result).toEqual({})
	})

	it('create cookie jar from cookie string', async () => {
		const set = {
			headers: {},
			cookie: {}
		}
		const cookieString = 'fischl=Princess; eula=Noble; amber=Knight'
		const result = await parseCookie(set, cookieString)
		expect(result).toEqual({
			fischl: expect.any(Cookie),
			eula: expect.any(Cookie),
			amber: expect.any(Cookie)
		})
	})

	it('unsign cookie signature', async () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const secrets = 'Fischl von Luftschloss Narfidort'

		const fischl = await signCookie('fischl', secrets)
		const cookieString = `fischl=${fischl}`
		const result = await parseCookie(set, cookieString, {
			secrets,
			sign: ['fischl']
		})

		expect(result.fischl.value).toEqual('fischl')
	})

	it('unsign multiple signature', async () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const secrets = 'Fischl von Luftschloss Narfidort'

		const fischl = await signCookie('fischl', secrets)
		const eula = await signCookie('eula', secrets)

		const cookieString = `fischl=${fischl}; eula=${eula}`
		const result = await parseCookie(set, cookieString, {
			secrets,
			sign: ['fischl', 'eula']
		})

		expect(result.fischl.value).toEqual('fischl')
		expect(result.eula.value).toEqual('eula')
	})

	// it('parse JSON value', async () => {
	// 	const set = {
	// 		headers: {},
	// 		cookie: {}
	// 	}

	// 	const value = {
	// 		eula: 'Vengeance will be mine'
	// 	}

	// 	const cookieString = `letter=${encodeURIComponent(
	// 		JSON.stringify(value)
	// 	)}`
	// 	const result = await parseCookie(set, cookieString)
	// 	expect(result.letter.value).toEqual(value)
	// })

	// it('parse true', async () => {
	// 	const set = {
	// 		headers: {},
	// 		cookie: {}
	// 	}

	// 	const cookieString = `letter=true`
	// 	const result = await parseCookie(set, cookieString)
	// 	expect(result.letter.value).toEqual(true)
	// })

	// it('parse false', async () => {
	// 	const set = {
	// 		headers: {},
	// 		cookie: {}
	// 	}

	// 	const cookieString = `letter=false`
	// 	const result = await parseCookie(set, cookieString)
	// 	expect(result.letter.value).toEqual(false)
	// })

	// it('parse number', async () => {
	// 	const set = {
	// 		headers: {},
	// 		cookie: {}
	// 	}

	// 	const cookieString = `letter=123`
	// 	const result = await parseCookie(set, cookieString)
	// 	expect(result.letter.value).toEqual(123)
	// })

	it('Unsign signature via secret rotation', async () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const secret = 'Fischl von Luftschloss Narfidort'

		const fischl = await signCookie('fischl', secret)
		const cookieString = `fischl=${fischl}`
		const result = await parseCookie(set, cookieString, {
			secrets: ['New Secret', secret],
			sign: ['fischl']
		})

		expect(result.fischl.value).toEqual('fischl')
	})

	// Regression (audit P3): signed-cookie verification must stay correct after
	// swapping the insecure `a === b` fallback (timing side channel off Bun)
	// for a constant-time compare. Valid signatures verify, tampered ones don't.
	it('verifies a valid signature and rejects a tampered one (constant-time)', async () => {
		const secret = 'Fischl von Luftschloss Narfidort'
		const signed = await signCookie('hello', secret)

		expect(await unsignCookie(signed, secret)).toBe('hello')
		expect(await unsignCookie('hello.bogus-signature', secret)).toBe(false)
		// flipping one byte of a valid signature must be rejected
		const flipped = signed.slice(0, -1) + (signed.at(-1) === 'A' ? 'B' : 'A')
		expect(await unsignCookie(flipped, secret)).toBe(false)
	})

	// Regression (audit P4): a `null` secret is the "allow unsigned" slot in a
	// rotation list. A value that LOOKS signed (contains a dot) used to fall
	// through to signCookie(value, null), which threw 'Secret key must be
	// provided' → a request-controlled 500 for any dotted value. It must just
	// not match (return false), while unsigned values are still accepted.
	it('null secret does not throw on a dotted value', async () => {
		expect(await unsignCookie('value.with.dots', null)).toBe(false)
		expect(await unsignCookie('plain', null)).toBe('plain')
	})

	// Regression (audit H3): incoming cookie values must be percent-decoded
	// EXACTLY once. `parse()` already decodes when the raw value contains '%',
	// and parseCookieRaw decoded a second time — so a correctly-encoded value
	// like `100%20off` (wire: `100%2520off`) was silently corrupted to
	// `100 off`. Decoding once must round-trip with what Elysia serializes.
	it('decodes a cookie value exactly once', async () => {
		const set = { headers: {}, cookie: {} }

		// `100%2520off` is the on-the-wire encoding of the literal `100%20off`
		const result = await parseCookie(set, 'discount=100%2520off')
		expect(result.discount.value).toBe('100%20off')

		// a single-encoded value must still decode (no under-decoding)
		const single = await parseCookie(set, 'greeting=hello%20world')
		expect(single.greeting.value).toBe('hello world')
	})
})
