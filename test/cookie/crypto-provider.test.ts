import { describe, expect, it } from 'bun:test'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
	hmacProvider,
	hasSyncHmac,
	signCookieBun,
	signCookieNode,
	signCookieSyncImpl,
	signCookieSubtle,
	signCookieSync,
	unsignCookieSync,
	unsignCookie,
	unsignWithSecretsSync,
	unsignWithSecrets
} from '../../src/cookie/crypto'

const secrets = [
	'Fischl von Luftschloss Narfidort',
	'a',
	'x'.repeat(64),
	'unicode-secret: 日本語 🗝️'
]

const values = [
	'',
	'hello',
	'session-user-8f14e45fceea167a5a36dedd4bea2543-v2',
	'a value with = padding trigger',
	'unicode: 日本語 🍣 café',
	JSON.stringify([{ name: 'Rin', role: 'Administration' }]),
	'x'.repeat(1024)
]

describe('cookie HMAC provider selection', () => {
	it('auto-selects the Bun provider under Bun (no flag, no config)', () => {
		// This suite runs under Bun with a keyed CryptoHasher that passed the
		// module-init parity probe — the selector must have picked it.
		expect(typeof Bun.CryptoHasher).toBe('function')
		expect(hmacProvider).toBe('bun')
		expect(hasSyncHmac).toBe(true)
		expect(signCookieSyncImpl).toBe(signCookieBun)
	})

	it('Bun.CryptoHasher and node:crypto paths produce IDENTICAL signature strings', () => {
		for (const secret of secrets)
			for (const value of values) {
				const viaBun = signCookieBun(value, secret)
				const viaNode = signCookieNode(value, secret)

				expect(viaBun).toBe(viaNode)

				// independent reference: raw node:crypto computed in-test,
				// not through the module under test
				const reference = `${value}.${createHmac('sha256', secret)
					.update(value)
					.digest('base64')
					.replace(/=+$/g, '')}`

				expect(viaBun).toBe(reference)
				expect(viaBun.endsWith('=')).toBe(false)
			}
	})

	it('subtle (WebCrypto) path is byte-identical to both sync providers', async () => {
		// signCookieSubtle is directly testable under Bun (crypto.subtle exists)
		for (const secret of secrets)
			for (const value of values) {
				const viaSubtle = await signCookieSubtle(value, secret)

				expect(viaSubtle).toBe(signCookieBun(value, secret))
				expect(viaSubtle).toBe(signCookieNode(value, secret))
			}
	})

	it('verify accepts canonical unpadded Base64 and rejects padded input (as before)', async () => {
		const secret = secrets[0]!
		const value = 'hello'

		const unpadded = signCookieSync(value, secret)
		const padded = `${value}.${createHmac('sha256', secret)
			.update(value)
			.digest('base64')}`

		// same digest, only padding differs
		expect(padded.replace(/=+$/g, '')).toBe(unpadded)

		expect(unsignCookieSync(unpadded, secret)).toBe(value)
		await expect(unsignCookie(unpadded, secret)).resolves.toBe(value)

		// exact-string (canonical unpadded) comparison: padded form rejected,
		// exactly as before the provider change
		expect(unsignCookieSync(padded, secret)).toBe(false)
		await expect(unsignCookie(padded, secret)).resolves.toBe(false)
	})

	it('secret rotation unchanged: new secret signs, old secret still verifies', async () => {
		const oldSecret = 'old-secret-rotation'
		const newSecret = 'new-secret-rotation'
		const rotation = [newSecret, oldSecret]

		const signedOld = signCookieSync('session', oldSecret)
		const signedNew = signCookieSync('session', newSecret)

		expect(unsignWithSecretsSync('sid', signedOld, rotation)).toBe(
			'session'
		)
		expect(unsignWithSecretsSync('sid', signedNew, rotation)).toBe(
			'session'
		)
		await expect(
			unsignWithSecrets('sid', signedOld, rotation)
		).resolves.toBe('session')
		await expect(
			unsignWithSecrets('sid', signedNew, rotation)
		).resolves.toBe('session')

		// a secret outside the rotation set must not verify
		expect(() =>
			unsignWithSecretsSync('sid', signedOld, ['unrelated'])
		).toThrow()
	})

	it('tampered value and tampered signature are both rejected', async () => {
		const secret = secrets[0]!
		const signed = signCookieSync('session', secret)
		const dot = signed.lastIndexOf('.')

		const tamperedValue = 'sessioN' + signed.slice(dot)
		const sig = signed.slice(dot + 1)
		const flip = (c: string) => (c === 'A' ? 'B' : 'A')
		const tamperedSig =
			signed.slice(0, dot + 1) + sig.slice(0, -1) + flip(sig.at(-1)!)

		expect(unsignCookieSync(tamperedValue, secret)).toBe(false)
		expect(unsignCookieSync(tamperedSig, secret)).toBe(false)
		await expect(unsignCookie(tamperedValue, secret)).resolves.toBe(false)
		await expect(unsignCookie(tamperedSig, secret)).resolves.toBe(false)
	})

	it('unsign paths reference the timing-safe comparison helper, not ===', () => {
		// ESM bindings cannot be spied on without module-cache pollution, so
		// assert at source level: both unsign implementations must flow the
		// comparison through constantTimeEqual and never bare-compare the
		// expected signature against the input.
		const source = readFileSync(
			join(import.meta.dir, '../../src/cookie/crypto.ts'),
			'utf8'
		)

		const usages = source.match(
			/constantTimeEqual\(expectedInput, input\)/g
		)

		// once in unsignCookie, once in unsignCookieSync
		expect(usages?.length).toBe(2)
		expect(source).not.toContain('expectedInput === input')
		expect(source).not.toContain('input === expectedInput')
		expect(source).toContain(
			"import { constantTimeEqual } from '../utils'"
		)
	})
})
