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

		await expect(unsignCookie(signed, secret)).resolves.toBe('hello')
		await expect(
			unsignCookie('hello.bogus-signature', secret)
		).resolves.toBe(false)
		// flipping one byte of a valid signature must be rejected
		const flipped =
			signed.slice(0, -1) + (signed.at(-1) === 'A' ? 'B' : 'A')
		await expect(unsignCookie(flipped, secret)).resolves.toBe(false)
	})

	// Regression (audit P4): a `null` secret is the "allow unsigned" slot in a
	// rotation list. A value that LOOKS signed (contains a dot) used to fall
	// through to signCookie(value, null), which threw 'Secret key must be
	// provided' → a request-controlled 500 for any dotted value. It must just
	// not match (return false), while unsigned values are still accepted.
	it('null secret does not throw on a dotted value', async () => {
		await expect(unsignCookie('value.with.dots', null)).resolves.toBe(false)
		await expect(unsignCookie('plain', null)).resolves.toBe('plain')
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

	// Regression (perf audit F5): signCookie caches imported HMAC CryptoKeys
	// per secret at module level — the cache must not change the signature
	// bytes, so pin them against an independent HMAC implementation
	it('produces byte-identical signatures with the cached CryptoKey', async () => {
		const { createHmac } = await import('node:crypto')
		const secret = 'Fischl von Luftschloss Narfidort'

		const expected =
			'fischl.' +
			createHmac('sha256', secret)
				.update('fischl')
				.digest('base64')
				.replace(/=+$/, '')

		// sign twice — the second call hits the cache and must match
		await expect(signCookie('fischl', secret)).resolves.toBe(expected)
		await expect(signCookie('fischl', secret)).resolves.toBe(expected)
	})

	// Regression (perf audit F5): the CryptoKey cache is keyed PER secret —
	// every secret in a rotation list must verify, not just the first one
	// cached
	it('verifies both rotation secrets after key caching', async () => {
		const oldSecret = 'old rotation secret'
		const newSecret = 'new rotation secret'

		// cache both keys via signing
		const signedOld = await signCookie('fischl', oldSecret)
		const signedNew = await signCookie('eula', newSecret)

		const set = { headers: {}, cookie: {} }
		const result = await parseCookie(
			set,
			`fischl=${signedOld}; eula=${signedNew}`,
			{
				secrets: [newSecret, oldSecret],
				sign: ['fischl', 'eula']
			}
		)

		expect(result.fischl.value).toEqual('fischl')
		expect(result.eula.value).toEqual('eula')

		// the wrong (but cached) key must still reject
		await expect(unsignCookie(signedOld, newSecret)).resolves.toBe(false)
	})

	// Regression (perf audit F5): the null/undefined-secret TypeError must
	// fire BEFORE the key-cache lookup — rotation lists legitimately contain
	// null slots
	it('signCookie still throws on a null secret', async () => {
		expect(signCookie('fischl', null)).rejects.toThrow(
			'Secret key must be provided'
		)
	})

	// Regression (perf audit F5): a FAILED importKey must self-evict from the
	// cache (the `.catch` on the cached promise). Without it, a transient
	// failure sticks a rejected promise in keyCache and every later sign with
	// that secret re-throws permanently. Verify a retry after a one-shot
	// failure succeeds.
	it('recovers after a transient importKey failure (rejected key self-evicts)', async () => {
		const subtle = crypto.subtle as {
			importKey: (...args: any[]) => Promise<CryptoKey>
		}
		const realImportKey = subtle.importKey.bind(crypto.subtle)
		const secret = 'transient-failure-secret-unique'
		let failNext = true

		subtle.importKey = (...args: any[]) => {
			if (failNext) {
				failNext = false
				return Promise.reject(new Error('boom'))
			}
			return realImportKey(...args)
		}

		try {
			await expect(signCookie('v', secret)).rejects.toThrow('boom')

			// the rejected key must have evicted; the retry imports cleanly
			const signed = await signCookie('v', secret)
			expect(signed.startsWith('v.')).toBe(true)
			await expect(unsignCookie(signed, secret)).resolves.toBe('v')
		} finally {
			subtle.importKey = realImportKey
		}
	})
})
