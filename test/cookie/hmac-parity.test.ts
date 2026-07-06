import '../../src/compile/aot-capture' // installs build-only capture impl (mirrors the AOT plugin)
import { describe, expect, it, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	Capture,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot'
import { compileHandler } from '../../src/compile/handler'
import { req } from '../utils'

import {
	hasSyncHmac,
	signCookie,
	signCookieSync,
	signCookieSubtle,
	unsignCookie,
	unsignCookieSync
} from '../../src/cookie/utils'

/**
 * H3 — signed-cookie HMAC is served by a sync `node:crypto` path when available
 * (Bun/Node), falling back to the async `crypto.subtle` WebCrypto path on edge
 * runtimes without `node:crypto` (Cloudflare Workers without `nodejs_compat`,
 * browsers). This file is the correctness net for that split:
 *
 *   1. BYTE PARITY — the sync and WebCrypto implementations must produce
 *      byte-identical signatures for the same (value, secret). If they ever
 *      diverge, cookies signed under one deployment stop verifying under the
 *      other (a silent auth/session break), so this is the load-bearing test.
 *   2. CROSS-PATH ROUND-TRIP — a signature produced by either path must verify
 *      under either path (old deployments' cookies keep working after upgrade).
 *   3. ASYNC UN-FORCING — with a sync HMAC available, a signed-cookie route no
 *      longer forces the whole compiled handler async; the codegen must emit a
 *      plain `Function`, not an `AsyncFunction`.
 */

const secret = 'the-seven-wailings-koan-of-jericho'
const cases = [
	'',
	'hello',
	'hello world',
	'a value with = padding trigger',
	'unicode: 日本語 🍣 café',
	JSON.stringify([{ name: 'Rin', role: 'Administration' }]),
	'x'.repeat(1024)
]

describe('cookie HMAC sync/subtle parity', () => {
	// Guard the whole premise: the sync path must actually be exercised in this
	// runtime (Bun ships `node:crypto`). If this ever flips, the perf win is
	// silently gone — fail loud rather than pass a vacuous parity check.
	it('sync node:crypto HMAC is available in this runtime', () => {
		expect(hasSyncHmac).toBe(true)
	})

	it('sync and WebCrypto signatures are byte-identical', async () => {
		for (const value of cases) {
			const sync = signCookieSync(value, secret)
			const subtle = await signCookieSubtle(value, secret)

			expect(sync).toBe(subtle)
			// format sanity: `value + '.' + base64(hmac)`, no '=' padding
			expect(sync.startsWith(value + '.')).toBe(true)
			expect(sync.endsWith('=')).toBe(false)
		}
	})

	it('public signCookie matches the WebCrypto reference byte-for-byte', async () => {
		for (const value of cases) {
			const viaPublic = await signCookie(value, secret)
			const viaSubtle = await signCookieSubtle(value, secret)

			expect(viaPublic).toBe(viaSubtle)
		}
	})

	it('a WebCrypto-signed cookie verifies via the sync unsign path', async () => {
		for (const value of cases) {
			const signed = await signCookieSubtle(value, secret)

			// signed by subtle → verified by node:crypto (upgrade compat)
			expect(unsignCookieSync(signed, secret)).toBe(value)
			// and the async public path still verifies it too
			await expect(unsignCookie(signed, secret)).resolves.toBe(value)
		}
	})

	it('a sync-signed cookie verifies via the WebCrypto unsign path', async () => {
		for (const value of cases) {
			const signed = signCookieSync(value, secret)

			// signed by node:crypto → verified by subtle (downgrade compat)
			const subtleSigned = await signCookieSubtle(value, secret)
			expect(signed).toBe(subtleSigned)
			await expect(unsignCookie(signed, secret)).resolves.toBe(value)
		}
	})

	it('sync unsign rejects a tampered signature (timing-safe compare preserved)', () => {
		const signed = signCookieSync('session', secret)
		const [payload] = signed.split('.')

		expect(unsignCookieSync(payload + '.deadbeef', secret)).toBe(false)
		expect(unsignCookieSync(signed, 'wrong-secret')).toBe(false)
		// no dot + a secret → not a signed cookie
		expect(unsignCookieSync('plain', secret)).toBe(false)
	})
})

describe('cookie HMAC async un-forcing (codegen)', () => {
	afterEach(() => {
		Compiled.clear()
		Validator.clear()
	})

	const compileRoute = (app: any, index = 0) => {
		const route = (app as Elysia).history![index]
		const fn = compileHandler(route as any, app)
		return { fn, name: fn.constructor.name, source: fn.toString() }
	}

	// A signed-cookie route whose every other moving part is sync. Before H3
	// this compiled to an AsyncFunction purely because signing was async.
	const signedApp = () =>
		new Elysia().get(
			'/',
			{
				cookie: t.Cookie(
					{ name: t.Optional(t.String()) },
					{ secrets: secret, sign: ['name'] }
				)
			},
			({ cookie: { name } }) => {
				name.value = 'himari'
				return 'ok'
			}
		)

	it('signed-cookie sync route compiles to a plain Function (not AsyncFunction)', () => {
		// only meaningful when the sync HMAC path is active
		expect(hasSyncHmac).toBe(true)

		const { name, source } = compileRoute(signedApp())

		expect(name).toBe('Function')
		// sync parse + sync sign, no `await` on the cookie path
		expect(source.includes('pcrsg(')).toBe(true)
		expect(source.includes('scvs(')).toBe(true)
		expect(source.includes('await pcr(')).toBe(false)
	})

	it('signed-cookie route round-trips correctly through app.handle', async () => {
		const app = signedApp()

		const res = await app.handle(req('/'))
		const setCookie = res.headers.get('set-cookie') ?? ''

		expect(setCookie.startsWith('name=himari.')).toBe(true)

		// the emitted signature must verify (round-trip through the parser):
		// feed it back in and the handler must accept it without a 400/500.
		const value = setCookie.split(';')[0].slice('name='.length)
		const echo = await app.handle(
			req('/', { headers: { cookie: `name=${value}` } })
		)
		expect(echo.status).toBe(200)
	})

	// The frozen AOT handler may ship to a runtime WITHOUT `node:crypto`
	// (Cloudflare Workers without `nodejs_compat`), where only `crypto.subtle`
	// exists. So under capture the codegen must stay conservatively async even
	// though `hasSyncHmac` is true in the build runtime — otherwise a sync
	// handler baked on Bun would break signed cookies on workerd.
	it('stays async (WebCrypto) under AOT capture regardless of hasSyncHmac', () => {
		expect(Capture.isCapturing()).toBe(false)

		const prev = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = '1'
		try {
			expect(Capture.isCapturing()).toBe(true)

			const { name, source } = compileRoute(signedApp())

			expect(name).toBe('AsyncFunction')
			expect(source.includes('await pcr(')).toBe(true)
			expect(source.includes('_sg=scv(')).toBe(true)
			// sync cookie helpers must NOT be linked under capture
			expect(source.includes('pcrsg(')).toBe(false)
			expect(source.includes('scvs(')).toBe(false)
		} finally {
			if (prev === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = prev
			// Reset AOT capture state: compileHandler under ELYSIA_AOT_BUILD=1
			// lazily initialises the module-level `capture` Map; even after the env
			// var is restored `isCapturing()` stays true until both maps are cleared.
			endValidatorCapture()
			endHandlerCapture()
		}
	})
})
