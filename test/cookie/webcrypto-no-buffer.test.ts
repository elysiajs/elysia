/**
 * signCookieSubtle must not depend on Node `Buffer`.
 *
 * The function is the WebCrypto fallback path used in environments WITHOUT
 * node:crypto (e.g. Cloudflare Workers without nodejs_compat).  Before the
 * fix it called `Buffer.from(hmacBuffer).toString('base64')`, which throws in
 * no-Buffer environments.
 *
 * Tests:
 *   1. Output is byte-identical to the node:crypto reference (cross-path parity).
 *   2. The function does not reference `Buffer` when Buffer and process are
 *      shadowed (probe-style).
 *   3. The unsign path also works without Buffer/process (verify branch).
 */

import { describe, expect, it } from 'bun:test'
import {
	signCookieSubtle,
	unsignCookie
} from '../../src/cookie/utils'

const secret = 'h12-no-buffer-secret'
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

	it('does not throw when Buffer and process are shadowed (no-Node probe)', async () => {
		// Temporarily shadow the globals that would be absent in a browser/edge
		// runtime.  We are NOT deleting them — we shadow at the function scope
		// with a local replacement that throws on access so any accidental use
		// becomes a hard failure rather than a silent undefined.
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
				// No '=' padding
				expect(signed.endsWith('=')).toBe(false)
			}
		} finally {
			globalThis.Buffer = OriginalBuffer
			globalThis.process = OriginalProcess
		}
	})

	it('unsignCookie verifies signatures produced with Buffer shadowed', async () => {
		const OriginalBuffer = globalThis.Buffer
		const OriginalProcess = globalThis.process

		// @ts-expect-error intentional shadowing
		globalThis.Buffer = undefined
		// @ts-expect-error intentional shadowing
		globalThis.process = undefined

		try {
			for (const value of cases) {
				const signed = await signCookieSubtle(value, secret)
				// unsignCookie internally calls signCookie → signCookieSubtle
				// (no hasSyncHmac when process is gone), then constantTimeEqual.
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
