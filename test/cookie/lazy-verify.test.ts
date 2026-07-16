/**
 * Signed cookies are verified when their value is observed. Explicit eager
 * verification and routes with cookie validators still verify at request entry.
 * Runtimes without synchronous HMAC support also use eager verification.
 */
import { describe, expect, it } from 'bun:test'
import Elysia from '../../src'
import { signCookieSync } from '../../src/cookie/utils'
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
	_cookieName: string
): Promise<void> {
	expect(res.status).toBe(400)
	const body = await res.json()
	// RFC 9457 problem+json
	expect(body.type).toBe('invalid-cookie')
}

// Skip all tests on runtimes without sync HMAC (the lazy lane is unavailable there)
if (!hasSyncHmac) {
	describe('lazy signed-cookie verification without synchronous HMAC', () => {
		it('skipped', () => {})
	})
} else {
	const SECRET = 'test-lazy-secret'

	// A valid signed cookie must be accessible by value.
	it('reads a valid signed cookie', async () => {
		const val = signed('hello', SECRET)

		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', `sid=${val}`))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('hello')
	})

	// Signature failure must surface even when verification is deferred.
	it('rejects an invalid signature when the handler reads it', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', 'sid=garbage.nothmac'))
		await expectInvalidCookieError(res, 'sid')
	})

	// Verification happens on access, so an unread invalid cookie is ignored.
	it('allows an unread invalid signed cookie', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', () => 'ok') // never reads c.cookie

		const res = await app.handle(req('/', 'sid=garbage.nothmac'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('ok')
	})

	// A conditional read makes the verification boundary observable.
	it('verifies an invalid signature only on the branch that reads it', async () => {
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
		const withFlag = await app.handle(
			req('/?flag=1', 'sid=garbage.nothmac')
		)
		await expectInvalidCookieError(withFlag, 'sid')
	})

	// Runtime Cookie access, not source analysis, owns verification timing.
	it('verifies through an aliased jar only when its value is read', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie, query: { read } }) => {
			const jar = cookie
			if (read) return jar.sid.value
			return 'ok'
		})

		const unread = await app.handle(req('/', 'sid=garbage.nothmac'))
		expect(unread.status).toBe(200)
		expect(await unread.text()).toBe('ok')

		const read = await app.handle(req('/?read=1', 'sid=garbage.nothmac'))
		await expectInvalidCookieError(read, 'sid')
	})

	it('verifies through computed access only when its value is read', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie, query: { read } }) => {
			const name = 'sid'
			if (read) return cookie[name].value
			return 'ok'
		})

		const unread = await app.handle(req('/', 'sid=garbage.nothmac'))
		expect(unread.status).toBe(200)

		const read = await app.handle(req('/?read=1', 'sid=garbage.nothmac'))
		await expectInvalidCookieError(read, 'sid')
	})

	it('resolves pending cookies before reflection exposes descriptors', async () => {
		let pending: boolean | undefined
		let exposedSecret: unknown

		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', function ({ cookie }: any) {
			void cookie.sid
			const entry = Object.getOwnPropertyDescriptor(
				arguments[0].cookie,
				'sid'
			)?.value

			pending = Object.prototype.hasOwnProperty.call(entry, '~unsign')
			exposedSecret = entry?.['~unsign']

			return entry?.value
		})

		const value = signed('hello', SECRET)
		const valid = await app.handle(req('/', `sid=${value}`))
		expect(valid.status).toBe(200)
		expect(await valid.text()).toBe('hello')
		expect(pending).toBe(false)
		expect(exposedSecret).toBeUndefined()

		const invalid = await app.handle(req('/', 'sid=garbage.nothmac'))
		await expectInvalidCookieError(invalid, 'sid')
	})

	it('verifies before every property-descriptor API exposes a cookie', async () => {
		const operations = {
			reflect: (jar: any) =>
				Reflect.getOwnPropertyDescriptor(jar, 'sid')?.value.value,
			all: (jar: any) =>
				Object.getOwnPropertyDescriptors(jar).sid.value.value
		}

		for (const [name, operation] of Object.entries(operations)) {
			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'] }
			}).get(`/${name}`, function ({ cookie }: any) {
				void cookie.sid
				return operation(arguments[0].cookie)
			})

			const res = await app.handle(req(`/${name}`, 'sid=garbage.nothmac'))
			await expectInvalidCookieError(res, 'sid')
		}
	})

	it('verifies pending values only when enumeration executes', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', function ({ cookie, query: { read } }: any) {
			void cookie.sid
			if (read) return Object.keys(arguments[0].cookie).join(',')
			return 'ok'
		})

		const unread = await app.handle(req('/', 'sid=garbage.nothmac'))
		expect(unread.status).toBe(200)

		const enumerated = await app.handle(
			req('/?read=1', 'sid=garbage.nothmac')
		)
		await expectInvalidCookieError(enumerated, 'sid')
	})

	// Explicit eager verification must restore eager behavior everywhere.
	// The handler touches c.cookie but reads another key, so only eager mode
	// verifies the unread signed cookie.
	it("verify:'eager' rejects an unread invalid signed cookie", async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'], verify: 'eager' }
		}).get('/', ({ cookie: { other } }) => other.value ?? 'none')

		// 'other' is not signed; 'sid' is signed but unread.
		// With verify:'eager', the bad sid sig must cause 400 at parse time.
		const res = await app.handle(
			req('/', 'sid=garbage.nothmac; other=hello')
		)
		expect(res.status).toBe(400)
	})

	// The validator consumes raw cookies before the jar exists, so these routes
	// must verify eagerly.
	it('eagerly verifies and unsigns cookies before cookie validation', async () => {
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

	// Secret rotation must try every configured secret.
	it('accepts a cookie signed with an older rotation secret', async () => {
		const secrets = ['new-secret', 'old-secret']
		const val = signed('rotated', 'old-secret') // signed with secrets[1]

		const app = new Elysia({
			cookie: { secrets, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', `sid=${val}`))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('rotated')
	})

	// JSON decoding and raw-value tracking must work on the lazy path so an
	// unchanged object is not signed again.
	it('round-trips an unchanged signed JSON object without re-signing it', async () => {
		const obj = { count: 7 }
		const jsonStr = JSON.stringify(obj)
		const val = signed(jsonStr, SECRET)

		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['data'] }
		}).get('/', ({ cookie: { data } }) => data.value)

		const res = await app.handle(
			req('/', `data=${encodeURIComponent(val)}`)
		)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toEqual({ count: 7 })

		// Unchanged read must NOT produce a Set-Cookie (no re-sign)
		expect(res.headers.getAll('set-cookie').length).toBe(0)
	})

	// An attribute write promotes the entry into the outgoing jar. It must first
	// resolve the original value so the inbound signature is not signed again.
	it('re-signs the original value once when only an attribute changes', async () => {
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

	// A dotless value is unsigned and must be rejected unless a null secret is
	// present in the rotation array.
	it('rejects a dotless value when no null secret is configured', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		// A value without a dot is not a valid signed cookie
		const res = await app.handle(req('/', 'sid=nodotvalue'))
		expect(res.status).toBe(400)
	})

	// The pending-verification marker remains after failure so another access
	// cannot silently return the raw signed string.
	it('rejects every access after signature verification fails', async () => {
		let secondStatus: number | undefined

		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', async ({ cookie: { sid } }) => {
			try {
				void sid.value // first access — throws
			} catch {
				// swallow
			}
			try {
				void sid.value // second access — must still throw (marker retained)
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

	// Writing reads the current cookie first and must rethrow a prior verification
	// failure instead of silently succeeding.
	it('rejects a write after a caught verification failure', async () => {
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

	// A null member accepts unsigned values while other rotation members still
	// verify signed values.
	it('accepts signed and unsigned values when rotation includes a null secret', async () => {
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

	// An unsigned value on a signed name must never bypass verification merely
	// because it parses as JSON. Otherwise a non-string entry could skip pending
	// signature verification and reach the handler.
	// Signed cookies exist for tamper detection; a forged `{"admin":true}`
	// must be rejected exactly as the eager lane rejects it.
	it('rejects a forged unsigned JSON object on a signed name', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', 'sid={"admin":true}'))
		await expectInvalidCookieError(res, 'sid')
	})

	it('rejects a forged unsigned JSON array on a signed name', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', 'sid=[1,2,3]'))
		await expectInvalidCookieError(res, 'sid')
	})

	it('rejects a forged unsigned dotless string on a signed name', async () => {
		const app = new Elysia({
			cookie: { secrets: SECRET, sign: ['sid'] }
		}).get('/', ({ cookie: { sid } }) => sid.value)

		const res = await app.handle(req('/', 'sid=plainforgery'))
		await expectInvalidCookieError(res, 'sid')
	})
}
