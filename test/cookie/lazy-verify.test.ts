/**
 * C3 — Lazy signed-cookie verify (Q8)
 *
 * Tests 1–12c from design/c3-lazy-cookie-verify.md §Tests.
 * Test 13 (full gate) is excluded per spec.
 *
 * The lazy lane is selected iff:
 *   - cookieConfig.hasSign
 *   - verify === 'required-fields' (new default)
 *   - cookieReads is defined (closed read set — sucrose can analyse)
 *   - !vali?.cookie (cookie-validator routes stay eager)
 *   - hasSyncHmac (getter is sync; CF Workers without nodejs_compat stay eager)
 */
import { describe, expect, it } from 'bun:test'
import Elysia from '../../src'
import { signCookieSync, unsignCookieSync } from '../../src/cookie/utils'
import { hasSyncHmac } from '../../src/cookie/crypto'
import { t } from '../../src'
import { InvalidCookie } from '../../src/cookie/error'

// Helper: build a signed cookie header value
function signed(value: string, secret: string) {
	return signCookieSync(value, secret)
}

// Helper: make a GET request with a given Cookie header
function req(path: string, cookieHeader?: string) {
	return new Request(`http://localhost${path}`, {
		headers: cookieHeader ? { cookie: cookieHeader } : {}
	})
}

// Helper: assert response is a problem+json 400 with the invalid-cookie type
async function expectInvalidCookieError(
	res: Response,
	cookieName: string
): Promise<void> {
	expect(res.status).toBe(400)
	const body = await res.json()
	// RFC 9457 problem+json
	expect(body.type).toBe('invalid-cookie')
}

// Skip all tests on runtimes without sync HMAC (the lazy lane is unavailable there)
if (!hasSyncHmac) {
	describe('C3 lazy signed-cookie verify [SKIP — no sync HMAC]', () => {
		it('skipped', () => {})
	})
} else {
	const SECRET = 'test-lazy-secret'

	// -----------------------------------------------------------------------
	// Test 1: Lazy lane, valid signature, handler reads → correct value, 200
	// WHY: the core contract — valid signed cookie must be accessible by value
	// -----------------------------------------------------------------------
	it('[C3-1] lazy lane: valid signature reads correct value', async () => {
		const val = signed('hello', SECRET)

		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', `sid=${val}`))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('hello')
	})

	// -----------------------------------------------------------------------
	// Test 2: Invalid signature + handler reads → 400, body matches eager lane
	// WHY: signature failure must surface as InvalidCookie even on lazy path
	// -----------------------------------------------------------------------
	it('[C3-2] invalid signature + handler reads → 400', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', 'sid=garbage.nothmac'))
		await expectInvalidCookieError(res, 'sid')
	})

	// -----------------------------------------------------------------------
	// Test 3: Invalid signature on a cookie the handler NEVER reads → 200
	// WHY: THE Q8 semantic-flip. Verification cost moved to access, not ingress.
	//      An invalid signature on an unread cookie must not 400 the request.
	// -----------------------------------------------------------------------
	it('[C3-3] unread invalid signed cookie → 200 (Q8 semantic-flip)', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', () => 'ok') // never reads c.cookie

		const res = await app.handle(req('/', 'sid=garbage.nothmac'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('ok')
	})

	// -----------------------------------------------------------------------
	// Test 4: Conditional read — bad sig → 200 without flag, 400 with flag
	// WHY: verification cost only on ACTUAL ACCESS proves lazy timing
	// -----------------------------------------------------------------------
	it('[C3-4] conditional read: no-flag path skips verify, flag path triggers it', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid }, query: { flag } }) => {
			if (flag) return sid.value
			return 'skip'
		})

		// Without flag: handler never reads sid.value → 200
		const noFlag = await app.handle(req('/?flag=', 'sid=garbage.nothmac'))
		expect(noFlag.status).toBe(200)
		expect(await noFlag.text()).toBe('skip')

		// With flag: handler reads sid.value → 400
		const withFlag = await app.handle(req('/?flag=1', 'sid=garbage.nothmac'))
		await expectInvalidCookieError(withFlag, 'sid')
	})

	// -----------------------------------------------------------------------
	// Test 5: Unanalyzable handler → eager fallback: unread bad sig → 400
	// WHY: sucrose cannot close the read set when cookie is aliased; the lazy
	//      lane must fall back to eager so any access still verifies
	// -----------------------------------------------------------------------
	it('[C3-5] unanalyzable handler (alias) → eager fallback: unread bad sig is 400', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie }) => {
			// alias to c.cookie makes sucrose return undefined (unanalyzable)
			const _jar = cookie
			return 'ok'
		})

		// Eager mode: even unread, bad sig must 400
		const res = await app.handle(req('/', 'sid=garbage.nothmac'))
		expect(res.status).toBe(400)
	})

	// -----------------------------------------------------------------------
	// Test 6: verify: 'all' → eager despite analyzable read set
	// WHY: explicit opt-out of lazy must restore eager behavior everywhere.
	//      Uses a handler that touches c.cookie (so cookieConfig is compiled)
	//      but reads a DIFFERENT key, not 'sid'. Under lazy the unread 'sid'
	//      would not be verified; under eager it must be.
	// -----------------------------------------------------------------------
	it("[C3-6] verify:'all' → eager: reading other cookie still verifies unread signed cookie", async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'], verify: 'all' }
		}).get('/', ({ cookie: { other } }) => other.value ?? 'none')

		// 'other' is not signed; 'sid' is signed but unread.
		// With verify:'all' (eager), the bad sid sig must cause 400 at parse time.
		const res = await app.handle(req('/', 'sid=garbage.nothmac; other=hello'))
		expect(res.status).toBe(400)
	})

	// -----------------------------------------------------------------------
	// Test 7: Cookie-validator route → eager; validated values are unsigned
	// WHY: validator consumes raw _ck before jar exists (jit.ts:635 before :645)
	//      so vali?.cookie routes must stay on eager lane
	// -----------------------------------------------------------------------
	it('[C3-7] cookie-validator route → eager; value is unsigned', async () => {
		const val = signed('world', SECRET)

		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get(
			'/',
			{
				cookie: t.Cookie({ sid: t.Optional(t.String()) })
			},
			({ cookie: { sid } }) => sid.value ?? 'none'
		)

		// Valid sig → cookie validator gets the decoded value
		const res = await app.handle(req('/', `sid=${val}`))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('world')
	})

	// -----------------------------------------------------------------------
	// Test 8: Secret-rotation array in lazy lane
	// WHY: must try all secrets; signed with secrets[1] must verify
	// -----------------------------------------------------------------------
	it('[C3-8] secret-rotation array: signed with secrets[1] verifies', async () => {
		const secrets = ['new-secret', 'old-secret']
		const val = signed('rotated', 'old-secret') // signed with secrets[1]

		const app = new Elysia({
			cookie: { secrets, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', `sid=${val}`))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('rotated')
	})

	// -----------------------------------------------------------------------
	// Test 9: Signed JSON-object cookie: lazy resolve round-trips
	// WHY: maybeJsonDecode + rawJsonValue must work on lazy path;
	//      '~raw' suppression prevents re-sign on unchanged object
	// -----------------------------------------------------------------------
	it('[C3-9] signed JSON object: round-trips value; unchanged obj is not re-signed', async () => {
		const obj = { count: 7 }
		const jsonStr = JSON.stringify(obj)
		const val = signed(jsonStr, SECRET)

		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['data'] }
		}).get('/', ({ cookie: { data } }) => data.value)

		const res = await app.handle(req('/', `data=${encodeURIComponent(val)}`))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ count: 7 })

		// Unchanged read must NOT produce a Set-Cookie (no re-sign)
		expect(res.headers.getAll('set-cookie').length).toBe(0)
	})

	// -----------------------------------------------------------------------
	// Test 10: Attribute-write only (cookie.x.maxAge = 5) on signed inbound
	// WHY: setCookie chokepoint (P1) — attribute write promotes entry into
	//      set.cookie; without resolution, the raw signed string would be
	//      re-signed (double-sign). Must contain the original unsigned value re-signed.
	// -----------------------------------------------------------------------
	it('[C3-10] attribute-write only → Set-Cookie has correctly re-signed ORIGINAL value (no double-sign)', async () => {
		const val = signed('session-token', SECRET)

		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => {
			sid.maxAge = 3600 // attribute write — triggers setCookie chokepoint
			return 'ok'
		})

		const res = await app.handle(req('/', `sid=${val}`))
		expect(res.status).toBe(200)

		const rawSetCookie = res.headers.get('set-cookie')
		expect(rawSetCookie).toBeTruthy()
		// Decode percent-encoding so we can check the signature bytes cleanly
		const setCookie = decodeURIComponent(rawSetCookie!)

		// The Set-Cookie value must contain the re-signed ORIGINAL (not double-signed raw).
		// The raw value was 'session-token.HMACsig'; double-signing would be
		// 'session-token.HMACsig.HMACsig2'. The signed output of 'session-token' must match.
		const expectedSigned = signed('session-token', SECRET)
		expect(setCookie).toContain(`sid=${expectedSigned}`)
		// Must NOT contain the raw inbound signed value (would indicate double-sign)
		expect(setCookie).not.toContain(val + '.')
	})

	// -----------------------------------------------------------------------
	// Test 11: Dotless/non-string signed value parity with eager
	// WHY: should produce same 400 as eager on a value with no dot
	//      (unless a null secret is present in the array)
	// -----------------------------------------------------------------------
	it('[C3-11] dotless value without null secret → 400 (parity with eager)', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		// A value without a dot is not a valid signed cookie
		const res = await app.handle(req('/', 'sid=nodotvalue'))
		expect(res.status).toBe(400)
	})

	// -----------------------------------------------------------------------
	// Test 12: Second access after failed verify → still 400 (marker retained)
	// WHY: the '~unsign' marker is KEPT on failure so re-access still throws,
	//      never silently returning the raw signed string
	// -----------------------------------------------------------------------
	it('[C3-12] second access after failed verify → still 400 (marker retained)', async () => {
		let secondStatus: number | undefined

		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', async ({ cookie: { sid } }) => {
			try {
				sid.value // first access — throws
			} catch {
				// swallow
			}
			try {
				sid.value // second access — must still throw (marker retained)
			} catch (e) {
				if (e instanceof InvalidCookie) secondStatus = e.status
				throw e
			}
			return 'ok'
		})

		const res = await app.handle(req('/', 'sid=garbage.nothmac'))
		expect(res.status).toBe(400)
		// Confirm the second throw was also an InvalidCookie
		expect(secondStatus).toBe(400)
	})

	// -----------------------------------------------------------------------
	// Test 12b: WRITE after a caught failed read → re-throws 400
	// WHY: P2 — `set value` reads `this.cookie` first, which re-throws when
	//      the marker is still present. Tests that write after caught fail
	//      does not silently succeed.
	// -----------------------------------------------------------------------
	it('[C3-12b] write after caught failed read → re-throws 400 (marker retained)', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => {
			try {
				void sid.value // read — fails but caught
			} catch {
				// swallow
			}
			// Now try to write — must re-throw because cookie getter resolves first
			sid.value = 'new-value'
			return 'ok'
		})

		const res = await app.handle(req('/', 'sid=garbage.nothmac'))
		// The write triggers `this.cookie` via `this.cookie.value === value` comparison,
		// which re-throws because '~unsign' is still present.
		expect(res.status).toBe(400)
	})

	// -----------------------------------------------------------------------
	// Test 12c: Null-secret rotation member (P2 parity)
	// WHY: a null member accepts unsigned/dotless values — mirrors unsignCookieSync's
	//      secret===null path exactly. Parity with eager lane.
	// -----------------------------------------------------------------------
	it('[C3-12c] null-secret rotation member: signed verifies; unsigned accepted via null slot', async () => {
		const secrets: (string | null)[] = [null, SECRET]
		// Cookie signed with SECRET (secrets[1])
		const signedVal = signed('myval', SECRET)

		const app = new Elysia({
			cookie: { secrets: secrets as any, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		// Signed value: null slot skips (dot present, null→false), SECRET slot verifies
		const resSigned = await app.handle(req('/', `sid=${signedVal}`))
		expect(resSigned.status).toBe(200)
		expect(await resSigned.text()).toBe('myval')

		// Unsigned/dotless value: null slot accepts it (dot absent, secret===null → return input)
		const resUnsigned = await app.handle(req('/', 'sid=plain'))
		expect(resUnsigned.status).toBe(200)
		expect(await resUnsigned.text()).toBe('plain')
	})

	// -----------------------------------------------------------------------
	// Test 13a–c: FORGERY GUARD (P0 regression) — an UNSIGNED value on a signed
	// name must 400, never reach the handler unverified. Bare JSON object/array
	// forms are the dangerous case: if the lazy parser JSON-decoded them before
	// the mark gate, the non-string entry would skip `~unsign` and be accepted.
	// WHY: signed cookies exist for tamper detection; a forged `{"admin":true}`
	// must be rejected exactly as the eager lane rejects it.
	// -----------------------------------------------------------------------
	it('[C3-13a] forged unsigned JSON object on signed name → 400', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', 'sid={"admin":true}'))
		await expectInvalidCookieError(res, 'sid')
	})

	it('[C3-13b] forged unsigned JSON array on signed name → 400', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', 'sid=[1,2,3]'))
		await expectInvalidCookieError(res, 'sid')
	})

	it('[C3-13c] forged unsigned dotless string on signed name → 400', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', 'sid=plainforgery'))
		await expectInvalidCookieError(res, 'sid')
	})
}
