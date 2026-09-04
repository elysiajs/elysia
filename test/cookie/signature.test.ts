import { describe, expect, it } from 'bun:test'
import { Cookie, signCookie, unsignCookie } from '../../src/cookie'
import { signCookieSubtle } from '../../src/cookie/crypto'
import { parseCookie } from '../utils/parse-cookie'

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

	it('verifies a valid signature and rejects tampered signatures', async () => {
		const secret = 'Fischl von Luftschloss Narfidort'
		const signed = await signCookie('hello', secret)

		await expect(unsignCookie(signed, secret)).resolves.toBe('hello')
		await expect(
			unsignCookie('hello.bogus-signature', secret)
		).resolves.toBe(false)
		const flipped =
			signed.slice(0, -1) + (signed.at(-1) === 'A' ? 'B' : 'A')
		await expect(unsignCookie(flipped, secret)).resolves.toBe(false)
	})

	it('null secret does not throw on a dotted value', async () => {
		await expect(unsignCookie('value.with.dots', null)).resolves.toBe(false)
		await expect(unsignCookie('plain', null)).resolves.toBe('plain')
	})

	it('decodes a cookie value exactly once', async () => {
		const set = { headers: {}, cookie: {} }

		const result = await parseCookie(set, 'discount=100%2520off')
		expect(result.discount.value).toBe('100%20off')

		const single = await parseCookie(set, 'greeting=hello%20world')
		expect(single.greeting.value).toBe('hello world')
	})

	it('produces byte-identical signatures with the cached CryptoKey', async () => {
		const { createHmac } = await import('node:crypto')
		const secret = 'Fischl von Luftschloss Narfidort'

		const expected =
			'fischl.' +
			createHmac('sha256', secret)
				.update('fischl')
				.digest('base64')
				.replace(/=+$/, '')

		await expect(signCookie('fischl', secret)).resolves.toBe(expected)
		await expect(signCookie('fischl', secret)).resolves.toBe(expected)
	})

	it('caches CryptoKeys independently for each rotation secret', async () => {
		const oldSecret = 'old rotation secret'
		const newSecret = 'new rotation secret'

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

		await expect(unsignCookie(signedOld, newSecret)).resolves.toBe(false)
	})

	it('signCookie still throws on a null secret', async () => {
		await expect(signCookie('fischl', null)).rejects.toThrow(
			'Secret key must be provided'
		)
	})

	it('signCookie refuses a blank secret and never accepts its MAC', async () => {
		// HMAC-SHA256 keyed with '' is keyless: the signature below was minted
		// offline with no knowledge of the deployment. Signing must refuse to
		// produce it and verification must refuse to accept it.
		const forged = 'admin.jV+K7rZOPOILU30ExIZAfq9IlkZhfPz0k+dvW3lPoIA'

		for (const blank of ['', '   ']) {
			await expect(signCookie('admin', blank)).rejects.toThrow(
				'Secret key must be provided'
			)
			await expect(unsignCookie(forged, blank)).resolves.toBe(false)
		}
	})

	it('signCookieSubtle retries after a transient importKey failure', async () => {
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
			await expect(signCookieSubtle('v', secret)).rejects.toThrow('boom')

			const signed = await signCookieSubtle('v', secret)
			expect(signed.startsWith('v.')).toBe(true)
			await expect(unsignCookie(signed, secret)).resolves.toBe('v')
		} finally {
			subtle.importKey = realImportKey
		}
	})
})
