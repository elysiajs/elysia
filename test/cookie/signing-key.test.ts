import { describe, expect, it } from 'bun:test'

import { signCookieValues, unsignCookie } from '../../src/cookie/utils'
import { compileCookieConfig } from '../../src/cookie/config'

// Contract: in a rotation list, index 0 is the ACTIVE signing key — new
// cookies are always signed with `secrets[0]`. The remaining entries are
// accepted for verification only (rotation), never used to sign. This pins
// the selection so a future refactor can't silently sign with a later key.
describe('cookie signing key selection', () => {
	it('signs new cookies with index 0 of the rotation list', async () => {
		const newSecret = 'new-active-secret'
		const oldSecret = 'old-rotated-secret'

		const config = compileCookieConfig(undefined, {
			secrets: [newSecret, oldSecret],
			sign: ['session']
		})

		const cookies = { session: { value: 'hello' } } as any
		await signCookieValues(cookies, config)

		const signed = cookies.session.value as string

		// signed with index 0 (new secret), NOT the old one
		await expect(unsignCookie(signed, newSecret)).resolves.toBe('hello')
		await expect(unsignCookie(signed, oldSecret)).resolves.toBe(false)
	})

	it('a null at index 0 means no active key → signing throws (fail loud)', async () => {
		const config = compileCookieConfig(undefined, {
			// graceful-transition list with a real key, but null is first
			secrets: [null, 'real-secret'] as any,
			sign: ['session']
		})

		const cookies = { session: { value: 'hello' } } as any

		// index 0 is null → there is no active signing key, so it must throw
		// rather than silently signing with the later (real) secret.
		expect(() => signCookieValues(cookies, config)).toThrow(
			'Cookie field "session" is signed but no `secrets` is provided.'
		)
	})
})
