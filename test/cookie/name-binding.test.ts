import { describe, expect, it, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { aot as bunAot } from '../../src/plugin/aot/bun'
import { websocket } from '../../src/plugin/websocket'

import {
	deriveSignKey,
	signCookie,
	signCookieSync,
	unsignCookie,
	unsignCookieSync,
	unsignWithSecrets,
	unsignWithSecretsSync
} from '../../src/cookie/crypto'
import { signCookieValues } from '../../src/cookie/utils'
import { compileCookieConfig } from '../../src/cookie/config'

/**
 * A cookie signature that covers only the value authenticates the *bytes*, not
 * the *slot* they were minted for. With one secret spanning a low-value name
 * and a high-value one, the low-value cookie's MAC is a valid MAC for the
 * high-value name — so anything the app lets a user put in `pref` transposes
 * verbatim into `session`. Signing under a key derived from the cookie name
 * removes the transposition; the legacy fallback keeps already-issued cookies
 * readable until an app has re-issued them.
 */

const SECRET = 'Fischl von Luftschloss Narfidort'

/** Raw (still URL-encoded) `Set-Cookie` value, ready to replay as a request. */
const emitted = (res: Response, name: string) => {
	const header = res.headers
		.getAll('set-cookie')
		.find((c) => c.startsWith(name + '='))!

	expect(header).toBeTruthy()

	return header.split(';')[0]!.slice(name.length + 1)
}

const withCookie = (cookie: string) => ({ headers: { cookie } })

describe('cookie signature name binding', () => {
	afterEach(() => {
		Compiled.clear()
		Validator.clear()
	})

	it('rejects a signature minted for a different cookie name', () => {
		// The finding, at the primitive: one secret, two names, one MAC.
		const signed = signCookieSync('admin', SECRET, 'pref')

		expect(unsignCookieSync(signed, SECRET, 'pref')).toBe('admin')
		expect(unsignCookieSync(signed, SECRET, 'session')).toBe(false)
	})

	it("does not let one cookie's value be replayed under another name", async () => {
		// End-to-end shape of the attack: the app itself mints the low-value
		// cookie, so the attacker never has to forge anything — they only move
		// a legitimately signed value into the privileged slot.
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['pref', 'session'] }
		})
			.get('/set-pref', ({ cookie: { pref } }) => {
				pref.value = 'admin'
				return 'ok'
			})
			.get('/pref', ({ cookie: { pref } }) => pref.value ?? 'none')
			.get(
				'/session',
				({ cookie: { session } }) => session.value ?? 'none'
			)

		const minted = emitted(await app.handle('/set-pref'), 'pref')

		const own = await app.handle('/pref', withCookie(`pref=${minted}`))
		expect(own.status).toBe(200)
		await expect(own.text()).resolves.toBe('admin')

		const transposed = await app.handle(
			'/session',
			withCookie(`session=${minted}`)
		)
		expect(transposed.status).toBe(400)
		await expect(transposed.json()).resolves.toMatchObject({
			type: 'invalid-cookie'
		})
	})

	it('blocks transposition between per-field secrets that happen to match', () => {
		// Per-field `secrets` was the documented workaround for this finding.
		// Two fields configured with the same string must still not share MACs.
		const signed = signCookieSync('admin', SECRET, 'token')

		expect(unsignCookieSync(signed, SECRET, 'other')).toBe(false)
	})

	it('round-trips its own signatures, including under rotation', async () => {
		const app = new Elysia({
			cookie: {
				secrets: [SECRET, 'previous-secret'],
				sign: ['session'],
				// strict: only name-bound signatures are acceptable
				legacySignature: false
			}
		})
			.get('/set', ({ cookie: { session } }) => {
				session.value = 'himari'
				return 'ok'
			})
			.get('/read', ({ cookie: { session } }) => session.value)

		const minted = emitted(await app.handle('/set'), 'session')

		const read = await app.handle('/read', withCookie(`session=${minted}`))
		expect(read.status).toBe(200)
		await expect(read.text()).resolves.toBe('himari')

		// a retired secret still verifies, bound to the same name
		const old = signCookieSync('himari', 'previous-secret', 'session')
		const rotated = await app.handle(
			'/read',
			withCookie(`session=${encodeURIComponent(old)}`)
		)
		expect(rotated.status).toBe(200)

		// ...but not a value the retired secret signed for another name
		const elsewhere = signCookieSync('himari', 'previous-secret', 'pref')
		const moved = await app.handle(
			'/read',
			withCookie(`session=${encodeURIComponent(elsewhere)}`)
		)
		expect(moved.status).toBe(400)
	})
})

describe('cookie signature legacy fallback', () => {
	afterEach(() => {
		Compiled.clear()
		Validator.clear()
	})

	/** A signature as an earlier version minted it: no name in the key. */
	const legacySigned = (value: string, secret = SECRET) =>
		encodeURIComponent(signCookieSync(value, secret))

	const readApp = (config: Record<string, unknown>) =>
		new Elysia({
			cookie: { secrets: SECRET, sign: ['session'], ...config }
		}).get('/', ({ cookie: { session } }) => session.value)

	it('accepts a pre-binding signature by default', async () => {
		// Upgrading must not sign every live session out.
		const res = await readApp({}).handle(
			'/',
			withCookie(`session=${legacySigned('himari')}`)
		)

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('himari')
	})

	it('accepts a pre-binding signature in the eager lane too', async () => {
		const res = await readApp({ verify: 'eager' }).handle(
			'/',
			withCookie(`session=${legacySigned('himari')}`)
		)

		expect(res.status).toBe(200)
	})

	it('rejects a pre-binding signature once the fallback is off', async () => {
		const res = await readApp({ legacySignature: false }).handle(
			'/',
			withCookie(`session=${legacySigned('himari')}`)
		)

		expect(res.status).toBe(400)
	})

	it('rejects a pre-binding signature with the fallback off in the eager lane', async () => {
		const res = await readApp({
			verify: 'eager',
			legacySignature: false
		}).handle('/', withCookie(`session=${legacySigned('himari')}`))

		expect(res.status).toBe(400)
	})

	it('honours a route-level opt-out over a permissive app default', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET }
		}).get(
			'/',
			{
				cookie: t.Cookie(
					{ session: t.Optional(t.String()) },
					{ sign: ['session'], legacySignature: false }
				)
			},
			({ cookie: { session } }) => session.value ?? 'none'
		)

		const res = await app.handle(
			'/',
			withCookie(`session=${legacySigned('himari')}`)
		)

		expect(res.status).toBe(400)
	})

	it('leaves transposition of pre-binding signatures open until it is off', async () => {
		// The cost of the migration window, stated out loud: a legacy MAC is
		// name-agnostic by construction, so during the fallback period an
		// *already issued* cookie can still be moved between names. Turning
		// the fallback off is what closes the finding completely.
		const legacy = legacySigned('admin')

		const permissive = await readApp({}).handle(
			'/',
			withCookie(`session=${legacy}`)
		)
		expect(permissive.status).toBe(200)

		const strict = await readApp({ legacySignature: false }).handle(
			'/',
			withCookie(`session=${legacy}`)
		)
		expect(strict.status).toBe(400)
	})

	it('does not conflate the fallback with a null rotation entry', async () => {
		// `null` in `secrets` is an opt-in for accepting *unsigned* cookies
		// during an unsigned -> signed migration. It is a separate decision
		// from accepting an old *signature*, and must survive the opt-out.
		const app = new Elysia({
			cookie: {
				secrets: [null, SECRET] as any,
				sign: ['session'],
				legacySignature: false
			}
		}).get('/', ({ cookie: { session } }) => session.value)

		const unsigned = await app.handle('/', withCookie('session=plain'))
		expect(unsigned.status).toBe(200)
		await expect(unsigned.text()).resolves.toBe('plain')

		const bound = await app.handle(
			'/',
			withCookie(
				`session=${encodeURIComponent(signCookieSync('himari', SECRET, 'session'))}`
			)
		)
		expect(bound.status).toBe(200)

		// the legacy signature is still refused: `null` is not a blanket amnesty
		const legacy = await app.handle(
			'/',
			withCookie(`session=${legacySigned('himari')}`)
		)
		expect(legacy.status).toBe(400)
	})

	it('bounds the verify fan-out at one HMAC per secret per enabled pass', () => {
		const rotation = ['a-secret', 'b-secret']
		const signed = signCookieSync('v', 'b-secret', 'sid')

		expect(unsignWithSecretsSync('sid', signed, rotation)).toBe('v')
		expect(unsignWithSecretsSync('sid', signed, rotation, true)).toBe('v')

		// a miss exhausts both passes and still refuses
		expect(() =>
			unsignWithSecretsSync('sid', 'v.nothmac', rotation, true)
		).toThrow()
	})
})

describe('cookie signature key derivation', () => {
	it('is injective even for names carrying a NUL', () => {
		// `secret + '\0' + name` would be ambiguous the moment either side can
		// carry the separator. Length-prefixing the name removes the
		// assumption: the parse of `<len>\0<name><secret>` is unique.
		const keys = [
			deriveSignKey('a', 'b\0c'),
			deriveSignKey('a\0b', 'c'),
			deriveSignKey('a\0', 'bc'),
			deriveSignKey('', 'abc'),
			deriveSignKey('abc', ''),
			deriveSignKey('c', 'a\0b'),
			deriveSignKey('bc', 'a')
		]

		expect(new Set(keys).size).toBe(keys.length)
	})

	it('never derives a usable key from an unusable secret', async () => {
		// HMAC under a zero-length key is publicly forgeable, and a derived key
		// is non-empty for *every* secret — so the blank-secret guard has to
		// read the raw secret, never the derived one.
		for (const blank of ['', '   ']) {
			expect(() => signCookieSync('admin', blank, 'session')).toThrow(
				'Secret key must be provided'
			)
			await expect(signCookie('admin', blank, 'session')).rejects.toThrow(
				'Secret key must be provided'
			)

			expect(unsignCookieSync('admin.x', blank, 'session')).toBe(false)
			await expect(
				unsignCookie('admin.x', blank, 'session')
			).resolves.toBe(false)
		}
	})

	it('refuses a MAC minted under the derived key of a blank secret', async () => {
		// The forgery an attacker can mint with no knowledge of the deployment,
		// once derivation is in play: HMAC keyed with `deriveSignKey('', name)`.
		const { createHmac } = await import('node:crypto')

		const forged =
			'admin.' +
			createHmac('sha256', deriveSignKey('', 'session'))
				.update('admin')
				.digest('base64')
				.replace(/=+$/, '')

		for (const blank of ['', '   ']) {
			expect(unsignCookieSync(forged, blank, 'session')).toBe(false)
			await expect(unsignCookie(forged, blank, 'session')).resolves.toBe(
				false
			)
		}
	})

	it('keeps the write path from signing under a blank derived key', () => {
		// `collectSignPending` derives after its own guard; a config that
		// smuggles a blank secret past compile time must still throw.
		const config = compileCookieConfig(undefined, {
			secrets: SECRET,
			sign: ['session']
		})
		config.globalSecrets = '   '

		expect(() =>
			signCookieValues({ session: { value: 'admin' } } as any, config)
		).toThrow('is signed but no `secrets` is provided')
	})

	it('leaves the public two-argument primitives express-compatible', async () => {
		// `signCookie` / `unsignCookie` are public. An omitted name keeps the
		// pre-binding keying so direct callers are untouched.
		const signed = await signCookie('himari', SECRET)

		expect(signed).toBe(signCookieSync('himari', SECRET))
		await expect(unsignCookie(signed, SECRET)).resolves.toBe('himari')
		expect(unsignCookieSync(signed, SECRET)).toBe('himari')
		expect(unsignCookieSync(signed, SECRET, 'session')).toBe(false)
	})

	it('binds the name on the asynchronous WebCrypto verify path too', async () => {
		// The Workers lane has no synchronous HMAC and runs its own unsign.
		const signed = signCookieSync('admin', SECRET, 'pref')

		await expect(unsignWithSecrets('pref', signed, SECRET)).resolves.toBe(
			'admin'
		)
		await expect(
			unsignWithSecrets('session', signed, SECRET, true)
		).rejects.toThrow()
	})
})

describe('cookie signature name binding across transports', () => {
	afterEach(() => {
		Compiled.clear()
		Validator.clear()
	})

	it('rejects a transposed cookie on a WebSocket upgrade', async () => {
		// The upgrade path verifies the same jar the HTTP lane does; a forged
		// or moved signature must not reach a 101.
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['pref', 'session'] }
		})
			.use(websocket())
			.ws('/s', {
				cookie: t.Cookie({ session: t.String() }),
				message(ws: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const upgrade = (cookie: string) =>
			fetch(`http://${app.server!.hostname}:${app.server!.port}/s`, {
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-version': '13',
					cookie
				}
			}).then((r) => r.status)

		const bound = encodeURIComponent(
			signCookieSync('himari', SECRET, 'session')
		)
		const transposed = encodeURIComponent(
			signCookieSync('himari', SECRET, 'pref')
		)

		const accepted = await upgrade(`session=${bound}`)
		const rejected = await upgrade(`session=${transposed}`)

		app.stop()

		expect(accepted).toBe(101)
		expect(rejected).toBe(400)
	})

	it('rejects a transposed cookie in a precompiled AOT build', async () => {
		// The AOT lane emits its own handler source; it links the same cookie
		// helpers, but "links the same helpers" is worth proving, not assuming.
		const entry = resolve(
			import.meta.dir,
			`_name-binding-app.${Date.now()}.ts`
		)
		const bundle = resolve(
			import.meta.dir,
			`_name-binding-bundle.${Date.now()}.mjs`
		)

		await Bun.write(
			entry,
			`import { Elysia, t } from '../../src'\n` +
				`export const app = new Elysia({\n` +
				`	cookie: { secrets: ${JSON.stringify(SECRET)}, sign: ['pref', 'session'] }\n` +
				`}).get('/', {\n` +
				`	cookie: t.Cookie({ session: t.Optional(t.String()) })\n` +
				`}, ({ cookie: { session } }) => session.value ?? 'none')\n`
		)

		const previous = process.env.ELYSIA_AOT_BUILD
		try {
			const result = await Bun.build({
				entrypoints: [entry],
				plugins: [
					bunAot(entry, {
						registerFrom: resolve(
							import.meta.dir,
							'../../src/compile/aot.ts'
						),
						strip: 'auto'
					})
				],
				target: 'bun'
			})
			expect(result.success).toBe(true)

			const text = await result.outputs[0]!.text()
			// the route really is served from precompiled artifacts: the
			// runtime handler compiler is a throwing stub in this bundle
			expect(text).toInclude('handler compiler JIT was stripped')

			await Bun.write(bundle, text)

			process.env.ELYSIA_AOT_BUILD = '1'
			const mod: any = await import(bundle)
			const app = (mod.app ?? mod.default) as Elysia<any, any>

			const bound = encodeURIComponent(
				signCookieSync('himari', SECRET, 'session')
			)
			const transposed = encodeURIComponent(
				signCookieSync('himari', SECRET, 'pref')
			)

			const accepted = await app.handle(
				'/',
				withCookie(`session=${bound}`)
			)
			expect(accepted.status).toBe(200)
			await expect(accepted.text()).resolves.toBe('himari')

			const rejected = await app.handle(
				'/',
				withCookie(`session=${transposed}`)
			)
			expect(rejected.status).toBe(400)
		} finally {
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous

			await rm(entry, { force: true })
			await rm(bundle, { force: true })
		}
	})
})
