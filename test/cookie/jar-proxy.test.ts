import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { hasSyncHmac, signCookieSync } from '../../src/cookie/crypto'

/**
 * The jar is a Proxy over the parsed cookie record whose traps are shared
 * across requests and read each jar's state from the handler. These pin what
 * must not change when that handler is reshaped: reflection still answers from
 * the cookie record itself, state never crosses requests, and a cookie named
 * after a trap or a handler field is just a cookie
 */

const req = (path: string, cookie?: string) =>
	new Request(`http://localhost${path}`, {
		headers: cookie ? { cookie } : {}
	})

for (const compiled of [true, false]) {
	const build = (app: Elysia<any, any, any, any, any, any>) =>
		compiled ? app.compile() : app

	describe(`cookie jar proxy (${compiled ? 'compiled' : 'interpreted'})`, () => {
		it('answers reflection from the sent cookies', async () => {
			const app = build(
				new Elysia().get('/', ({ cookie }: any) => {
					const before = Object.keys(cookie).sort().join(',')
					const has = 'a' in cookie && !('missing' in cookie)
					const deleted = delete cookie.a
					const after = Object.keys(cookie).sort().join(',')

					return { before, has, deleted, after, a: 'a' in cookie }
				})
			)

			const res = await app.handle(req('/', 'a=1; b=2'))
			await expect(res.json()).resolves.toEqual({
				before: 'a,b',
				has: true,
				deleted: true,
				after: 'b',
				a: false
			})
		})

		it('freezes the shape of the cookie record, not of a handler', async () => {
			const app = build(
				new Elysia().get('/', ({ cookie }: any) => {
					const extensible = Object.isExtensible(cookie)
					Object.preventExtensions(cookie)

					// a Proxy whose target is not the record would throw here:
					// a non-extensible target must report exactly its own keys
					return {
						extensible,
						after: Object.isExtensible(cookie),
						keys: Object.keys(cookie).join(','),
						b: cookie.b.value
					}
				})
			)

			const res = await app.handle(req('/', 'b=2'))
			await expect(res.json()).resolves.toEqual({
				extensible: true,
				after: false,
				keys: 'b',
				b: '2'
			})
		})

		it('keeps each request in its own jar', async () => {
			const app = build(
				new Elysia().get('/', ({ cookie }: any) => {
					const value = cookie.a.value
					cookie.seen.value = 'yes'

					return String(value)
				})
			)

			for (const value of ['1', '2', '3']) {
				const res = await app.handle(req('/', `a=${value}`))
				await expect(res.text()).resolves.toBe(value)
			}
		})

		it('reads cookies named after a trap or handler field', async () => {
			const names = [
				'set',
				'has',
				'get',
				'config',
				'cache',
				'materialized'
			]
			const app = build(
				new Elysia().get('/', ({ cookie }: any) =>
					names
						.map((name) => `${name}=${cookie[name].value}`)
						.join(';')
				)
			)

			const res = await app.handle(
				req('/', names.map((name, i) => `${name}=v${i}`).join('; '))
			)
			await expect(res.text()).resolves.toBe(
				names.map((name, i) => `${name}=v${i}`).join(';')
			)
		})

		it.skipIf(!hasSyncHmac)(
			'verifies a signed cookie lazily through the proxy',
			async () => {
				const secrets = 'jar-proxy-secret'
				const app = build(
					new Elysia({ cookie: { secrets, sign: ['sid'] } })
						.get('/read', ({ cookie }: any) => cookie.sid.value)
						.get('/untouched', () => 'ok')
						.get('/in', ({ cookie }: any) =>
							String('sid' in cookie)
						)
				)

				const valid = `sid=${signCookieSync('hello', secrets)}`
				const forged = 'sid=admin.nothmac'

				const read = await app.handle(req('/read', valid))
				await expect(read.text()).resolves.toBe('hello')

				// unread: never verified, so never rejected
				const untouched = await app.handle(req('/untouched', forged))
				expect(untouched.status).toBe(200)

				// presence of an unverified name must not be answered
				const presence = await app.handle(req('/in', forged))
				expect(presence.status).toBe(400)
			}
		)
	})
}
