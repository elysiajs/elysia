import { describe, expect, it } from 'bun:test'
import Elysia from '../../src'
import { signCookieSync, hasSyncHmac } from '../../src/cookie/crypto'
import { t } from '../../src'
import { InvalidCookie } from '../../src/cookie/error'

function signed(value: string, secret: string) {
	return signCookieSync(value, secret)
}

function req(path: string, cookieHeader?: string) {
	return new Request(`http://localhost${path}`, {
		headers: cookieHeader ? { cookie: cookieHeader } : {}
	})
}

async function expectInvalidCookieError(
	res: Response,
	_cookieName: string
): Promise<void> {
	expect(res.status).toBe(400)
	const body = await res.json()
	expect(body.type).toBe('invalid-cookie')
}

if (!hasSyncHmac) {
	describe('lazy signed-cookie verification without synchronous HMAC', () => {
		it('skipped', () => {})
	})
} else {
	describe('lazy signed-cookie verification', () => {
		const SECRET = 'test-lazy-secret'

		it('reads a valid signed cookie', async () => {
			const val = signed('hello', SECRET)

			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'] }
			}).get('/', ({ cookie: { sid } }) => sid.value)

			const res = await app.handle(req('/', `sid=${val}`))
			expect(res.status).toBe(200)
			await expect(res.text()).resolves.toBe('hello')
		})

		it('rejects an invalid signature when the handler reads it', async () => {
			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'] }
			}).get('/', ({ cookie: { sid } }) => sid.value)

			const res = await app.handle(req('/', 'sid=garbage.nothmac'))
			await expectInvalidCookieError(res, 'sid')
		})

		it('allows an unread invalid signed cookie', async () => {
			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'] }
			}).get('/', () => 'ok')

			const res = await app.handle(req('/', 'sid=garbage.nothmac'))
			expect(res.status).toBe(200)
			await expect(res.text()).resolves.toBe('ok')
		})

		it('verifies an invalid signature only on the branch that reads it', async () => {
			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'] }
			}).get('/', ({ cookie: { sid }, query: { flag } }) => {
				if (flag) return sid.value
				return 'skip'
			})

			const noFlag = await app.handle(
				req('/?flag=', 'sid=garbage.nothmac')
			)
			expect(noFlag.status).toBe(200)
			await expect(noFlag.text()).resolves.toBe('skip')

			const withFlag = await app.handle(
				req('/?flag=1', 'sid=garbage.nothmac')
			)
			await expectInvalidCookieError(withFlag, 'sid')
		})

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
			await expect(unread.text()).resolves.toBe('ok')

			const read = await app.handle(
				req('/?read=1', 'sid=garbage.nothmac')
			)
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

			const read = await app.handle(
				req('/?read=1', 'sid=garbage.nothmac')
			)
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
			await expect(valid.text()).resolves.toBe('hello')
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

				const res = await app.handle(
					req(`/${name}`, 'sid=garbage.nothmac')
				)
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

		it("verify:'eager' rejects an unread invalid signed cookie", async () => {
			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'], verify: 'eager' }
			}).get('/', ({ cookie: { other } }) => other.value ?? 'none')

			const res = await app.handle(
				req('/', 'sid=garbage.nothmac; other=hello')
			)
			expect(res.status).toBe(400)
		})

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

			const res = await app.handle(req('/', `sid=${val}`))
			expect(res.status).toBe(200)
			await expect(res.text()).resolves.toBe('world')
		})

		it('accepts a cookie signed with an older rotation secret', async () => {
			const secrets = ['new-secret', 'old-secret']
			const val = signed('rotated', 'old-secret')

			const app = new Elysia({
				cookie: { secrets, sign: ['sid'] }
			}).get('/', ({ cookie: { sid } }) => sid.value)

			const res = await app.handle(req('/', `sid=${val}`))
			expect(res.status).toBe(200)
			await expect(res.text()).resolves.toBe('rotated')
		})

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

			expect(res.headers.getAll('set-cookie').length).toBe(0)
		})

		it('re-signs the original value once when only an attribute changes', async () => {
			const val = signed('session-token', SECRET)

			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'] }
			}).get('/', ({ cookie: { sid } }) => {
				sid.maxAge = 3600
				return 'ok'
			})

			const res = await app.handle(req('/', `sid=${val}`))
			expect(res.status).toBe(200)

			const rawSetCookie = res.headers.get('set-cookie')
			expect(rawSetCookie).toBeTruthy()
			const setCookie = decodeURIComponent(rawSetCookie!)

			const expectedSigned = signed('session-token', SECRET)
			expect(setCookie).toContain(`sid=${expectedSigned}`)
			expect(setCookie).not.toContain(val + '.')
		})

		it('rejects a dotless value when no null secret is configured', async () => {
			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'] }
			}).get('/', ({ cookie: { sid } }) => sid.value)

			const res = await app.handle(req('/', 'sid=nodotvalue'))
			expect(res.status).toBe(400)
		})

		it('rejects every access after signature verification fails', async () => {
			let secondStatus: number | undefined

			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'] }
			}).get('/', async ({ cookie: { sid } }) => {
				try {
					void sid.value
				} catch {}
				try {
					void sid.value
				} catch (e) {
					if (e instanceof InvalidCookie) secondStatus = e.status
					throw e
				}
				return 'ok'
			})

			const res = await app.handle(req('/', 'sid=garbage.nothmac'))
			expect(res.status).toBe(400)
			expect(secondStatus).toBe(400)
		})

		it('rejects a write after a caught verification failure', async () => {
			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['sid'] }
			}).get('/', ({ cookie: { sid } }) => {
				try {
					void sid.value
				} catch {}
				sid.value = 'new-value'
				return 'ok'
			})

			const res = await app.handle(req('/', 'sid=garbage.nothmac'))
			expect(res.status).toBe(400)
		})

		it('accepts signed and unsigned values when rotation includes a null secret', async () => {
			const secrets: (string | null)[] = [null, SECRET]
			const signedVal = signed('myval', SECRET)

			const app = new Elysia({
				cookie: { secrets: secrets as any, sign: ['sid'] }
			}).get('/', ({ cookie: { sid } }) => sid.value)

			const resSigned = await app.handle(req('/', `sid=${signedVal}`))
			expect(resSigned.status).toBe(200)
			await expect(resSigned.text()).resolves.toBe('myval')

			const resUnsigned = await app.handle(req('/', 'sid=plain'))
			expect(resUnsigned.status).toBe(200)
			await expect(resUnsigned.text()).resolves.toBe('plain')
		})

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
	})
}
