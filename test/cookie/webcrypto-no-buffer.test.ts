import { describe, expect, it } from 'bun:test'
import { signCookieSubtle, unsignCookie } from '../../src/cookie/utils'

const secret = 'cookie-signing-secret'
const cases = [
	'',
	'hello',
	'hello world',
	'unicode: 日本語 🍣 café',
	'x'.repeat(512)
]

describe('signCookieSubtle is Buffer-free', () => {
	it('produces byte-identical output to the node:crypto HMAC reference', async () => {
		const { createHmac } = await import('node:crypto')

		for (const value of cases) {
			const expected =
				`${value}.` +
				createHmac('sha256', secret)
					.update(value)
					.digest('base64')
					.replace(/=+$/, '')

			const actual = await signCookieSubtle(value, secret)
			expect(actual).toBe(expected)
		}
	})

	it('signs without Buffer or process globals', async () => {
		const OriginalBuffer = globalThis.Buffer
		const OriginalProcess = globalThis.process

		// @ts-expect-error intentional shadowing for probe
		globalThis.Buffer = undefined
		// @ts-expect-error intentional shadowing for probe
		globalThis.process = undefined

		try {
			for (const value of cases) {
				const signed = await signCookieSubtle(value, secret)
				expect(signed.startsWith(`${value}.`)).toBe(true)
				expect(signed.endsWith('=')).toBe(false)
			}
		} finally {
			globalThis.Buffer = OriginalBuffer
			globalThis.process = OriginalProcess
		}
	})

	it('verifies signatures without Buffer or process globals', async () => {
		const OriginalBuffer = globalThis.Buffer
		const OriginalProcess = globalThis.process

		// @ts-expect-error intentional shadowing
		globalThis.Buffer = undefined
		// @ts-expect-error intentional shadowing
		globalThis.process = undefined

		try {
			for (const value of cases) {
				const signed = await signCookieSubtle(value, secret)
				const result = await unsignCookie(signed, secret)
				expect(result).toBe(value)
			}
		} finally {
			globalThis.Buffer = OriginalBuffer
			globalThis.process = OriginalProcess
		}
	})

	it('a tampered signature is still rejected without Buffer', async () => {
		const OriginalBuffer = globalThis.Buffer
		// @ts-expect-error intentional shadowing
		globalThis.Buffer = undefined

		try {
			const signed = await signCookieSubtle('session', secret)
			const [payload] = signed.split('.')
			const tampered = `${payload}.deadbeef`
			const result = await unsignCookie(tampered, secret)
			expect(result).toBe(false)
		} finally {
			globalThis.Buffer = OriginalBuffer
		}
	})
})
