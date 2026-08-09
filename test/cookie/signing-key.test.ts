import { describe, expect, it } from 'bun:test'

import { signCookieValues } from '../../src/cookie/utils'
import { unsignCookie } from '../../src/cookie/crypto'
import { compileCookieConfig } from '../../src/cookie/config'

describe('cookie signing key selection', () => {
	it('signs new cookies only with the first rotation secret', async () => {
		const activeSecret = 'new-active-secret'
		const previousSecret = 'old-rotated-secret'

		const config = compileCookieConfig(undefined, {
			secrets: [activeSecret, previousSecret],
			sign: ['session']
		})

		const cookies = { session: { value: 'hello' } } as any
		await signCookieValues(cookies, config)

		const signed = cookies.session.value as string

		// signatures are bound to the cookie name they were minted for
		await expect(
			unsignCookie(signed, activeSecret, 'session')
		).resolves.toBe('hello')
		await expect(
			unsignCookie(signed, previousSecret, 'session')
		).resolves.toBe(false)
	})

	it('does not fall back when the first rotation secret is null', async () => {
		const config = compileCookieConfig(undefined, {
			secrets: [null, 'real-secret'] as any,
			sign: ['session']
		})

		const cookies = { session: { value: 'hello' } } as any

		expect(() => signCookieValues(cookies, config)).toThrow(
			'Cookie field "session" is signed but no `secrets` is provided.'
		)
	})
})
