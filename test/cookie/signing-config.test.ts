import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { Cookie } from '../../src/cookie/cookie'
import { compileCookieConfig } from '../../src/cookie/config'
import { signCookie } from '../../src/cookie/crypto'
import {
	buildCookieJar,
	parseCookieRaw,
	parseCookieRawLazy,
	signCookieValues
} from '../../src/cookie/utils'

describe('cookie signing configuration', () => {
	it('rejects global signing without a usable secret', () => {
		expect(() => compileCookieConfig(undefined, { sign: true })).toThrow()
		expect(() =>
			compileCookieConfig(undefined, { sign: true, secrets: null })
		).toThrow()
	})

	it('rejects a rotation list containing only null', () => {
		expect(() =>
			compileCookieConfig(undefined, { sign: true, secrets: [null] })
		).toThrow()
	})

	it('rejects an empty or whitespace-only secret at configuration', () => {
		// An empty secret does not disable signing — it produces a real
		// HMAC-SHA256 under a zero-length key, which is a public function, so
		// anyone can mint a valid cookie for any value. The realistic trigger is
		// a deployment slip (`COOKIE_SECRET=` present-but-empty in a `.env`, an
		// empty Kubernetes secret), which must fail loudly at boot exactly like
		// an unset variable already does.
		for (const secrets of ['', '   ', [''], [null, '']])
			expect(() =>
				compileCookieConfig(undefined, {
					sign: true,
					secrets: secrets as any
				})
			).toThrow(/`cookie.secrets`/)

		expect(() =>
			compileCookieConfig(undefined, {
				sign: true,
				secrets: 'real-secret'
			})
		).not.toThrow()
	})

	it('never signs with an empty secret inside a rotation list', () => {
		// `['', 'real']` has a usable secret so it boots, but the write side
		// always uses secrets[0] — which would be the zero-length key.
		const config = compileCookieConfig(undefined, {
			secrets: ['', 'real-secret'],
			sign: ['session']
		})

		expect(() =>
			signCookieValues({ session: { value: 'hello' } } as any, config)
		).toThrow('is signed but no `secrets` is provided')
	})

	it('rejects a signed field whose secret resolves to null', () => {
		const schema = {
			config: { sign: ['token'] },
			properties: {
				token: { config: { sign: true, secrets: null } }
			}
		}

		expect(() => compileCookieConfig(schema as any, undefined)).toThrow()
	})

	it('accepts a rotation list with a usable secret and null', () => {
		expect(() =>
			compileCookieConfig(undefined, {
				sign: true,
				secrets: ['real-secret', null]
			})
		).not.toThrow()
	})

	it('never accepts a forged cookie when signing has no usable secret', async () => {
		let app: any
		try {
			app = new Elysia({
				cookie: { sign: true, secrets: null }
			}).get('/', ({ cookie }) => ({ token: cookie.token.value }))
		} catch {
			// Throwing at construction is itself "never accepts a forged cookie"
			return
		}

		let status = 0
		let body = ''
		try {
			const response = await app.handle(
				new Request('http://localhost/', {
					headers: { cookie: 'token=admin' }
				})
			)
			status = response.status
			body = await response.text()
		} catch {
			// Throwing while handling is itself "never accepts a forged cookie"
			return
		}

		expect(status === 200 && body.includes('admin')).toBe(false)
	})

	it('rejects an invalid signed read even if validation was bypassed', async () => {
		const config = {
			defaults: { path: '/' },
			fields: {},
			globalSign: true as const,
			globalSecrets: null,
			hasSign: true
		}

		await expect(
			parseCookieRaw('token=forged.fakesig', config as any)
		).rejects.toThrow()
	})

	it('rejects an unsigned write even if validation was bypassed', () => {
		const config = {
			defaults: { path: '/' },
			fields: {},
			globalSign: true as const,
			globalSecrets: [null],
			hasSign: true
		}
		const cookies = { token: { value: 'secret-data' } }

		expect(() => signCookieValues(cookies as any, config as any)).toThrow()
	})

	// `sign: true` declares every cookie signed. With no usable top-level
	// secret (an unset env var, or a rotation of only `null`, which accepts
	// unsigned values) a name without its own secret can't be verified, so a
	// read must reject it: handing over the client's value is an unsigned read
	// of a cookie the config calls signed
	const ownSecret = 'Fischl von Luftschloss Narfidort'
	const unverifiable = (secrets?: (string | null)[]) =>
		t.Cookie(
			{
				sid: t.Cookie(t.Optional(t.String()), { secrets: ownSecret }),
				role: t.Optional(t.String())
			},
			{ sign: true, secrets }
		)

	it('rejects reading a cookie declared signed that has no usable secret', async () => {
		for (const secrets of [undefined, [null], [null, '']]) {
			const cookie = unverifiable(secrets)
			const app = new Elysia().get(
				'/',
				{ cookie },
				({ cookie: { role } }) => role.value ?? 'none'
			)

			const response = await app.handle(
				new Request('http://localhost/', {
					headers: { cookie: 'role=admin' }
				})
			)
			expect(response.status).toBe(400)

			// verified on access: the read rejects, not the request
			const config = compileCookieConfig(cookie, undefined)
			const jar = buildCookieJar(
				{ headers: {} } as any,
				parseCookieRawLazy('role=admin', config),
				config,
				1
			)
			expect(() => jar.role.value).toThrow('invalid cookie signature')
		}
	})

	// only the unverifiable name is turned away: the config stays valid, and
	// writing that name keeps naming the missing secret, not a signature
	it('keeps the rest of a config without a top-level secret working', async () => {
		const cookie = unverifiable()
		const app = new Elysia()
			.get('/', { cookie }, ({ cookie: { sid } }) => sid.value ?? 'none')
			.get('/write', { cookie }, ({ cookie: { sid } }) => {
				sid.value = 'abc'
				return 'ok'
			})

		const signed = await signCookie('abc', ownSecret, 'sid')
		const get = (path: string, cookie?: string) =>
			app.handle(
				new Request('http://localhost' + path, {
					headers: cookie ? { cookie } : {}
				})
			)

		await expect((await get('/')).text()).resolves.toBe('none')
		await expect((await get('/', `sid=${signed}`)).text()).resolves.toBe(
			'abc'
		)

		const write = await get('/write')
		expect(write.status).toBe(200)
		expect(decodeURIComponent(write.headers.get('set-cookie')!)).toInclude(
			`sid=${signed}`
		)

		expect(() =>
			signCookieValues(
				{ role: { value: 'admin' } } as any,
				compileCookieConfig(cookie, undefined)
			)
		).toThrow('`cookie.secrets` is missing or empty')
	})

	// signing is decided by the app/route config alone: a per-cookie
	// `secrets` knob would read as signed while going out unsigned
	it('signs every jar write path on a route with signing config', async () => {
		const app = new Elysia({
			cookie: { secrets: 'k', sign: ['a', 'b', 'c'] }
		})
			.get('/', ({ cookie }) => {
				cookie.a.value = 'x'
				cookie.b.set({ value: 'y' })
				cookie.c.update({ value: 'z' })
				return 'ok'
			})
			.get('/read', ({ cookie }) =>
				[cookie.a.value, cookie.b.value, cookie.c.value].join()
			)

		const setCookie = (
			await app.handle(new Request('http://localhost/'))
		).headers
			.getSetCookie()
			.map((c) => c.slice(0, c.indexOf(';')))
		expect(setCookie).toHaveLength(3)
		for (const c of setCookie) expect(c).toMatch(/^[abc]=[xyz]\.[^.]+$/)

		const read = await app.handle(
			new Request('http://localhost/read', {
				headers: { cookie: setCookie.join('; ') }
			})
		)
		expect(read.status).toBe(200)
		await expect(read.text()).resolves.toBe('x,y,z')
	})

	it('exposes no per-cookie secrets accessor', () => {
		expect(
			Object.getOwnPropertyDescriptor(Cookie.prototype, 'secrets')
		).toBeUndefined()
	})

	// passing `secrets` to one cookie must fail loud instead of shipping it unsigned
	it('rejects a per-cookie secrets write through set() and update()', async () => {
		const errors: string[] = []
		const app = new Elysia()
			.onError(({ error }) => {
				errors.push((error as Error).message)
			})
			.get('/set', ({ cookie }) => {
				cookie.a.set({ value: 'x', secrets: 'k' } as any)
				return 'ok'
			})
			.get('/update', ({ cookie }) => {
				cookie.a.update(() => ({ value: 'x', secrets: 'k' }) as any)
				return 'ok'
			})

		for (const path of ['/set', '/update']) {
			const response = await app.handle(
				new Request('http://localhost' + path)
			)
			expect(response.status).toBe(500)
			expect(response.headers.getSetCookie()).toEqual([])
		}
		expect(errors).toHaveLength(2)
		for (const message of errors) expect(message).toContain('`secrets`')
	})

	// an updater that mutates what it is given must not leave a half-applied,
	// unsigned cookie behind when the result is rejected: the error response
	// carries only what was committed before (`before`), never `after`
	it('leaves no cookie behind when a mutating updater adds secrets', async () => {
		const mutate = (live: any) => {
			live.value = 'after'
			live.secrets = 'k'
			return live
		}
		const app = new Elysia()
			.get('/set', ({ cookie }) => {
				cookie.a.value = 'before'
				cookie.a.set(mutate)
			})
			.get('/update', ({ cookie }) => {
				cookie.a.value = 'before'
				cookie.a.update(mutate)
			})
			.get('/assign', ({ cookie }) => {
				cookie.a.cookie = { value: 'after', secrets: 'k' } as any
			})

		for (const [path, committed] of [
			['/set', ['a=before; Path=/']],
			['/update', ['a=before; Path=/']],
			['/assign', []]
		] as const) {
			const response = await app.handle(
				new Request('http://localhost' + path)
			)
			expect(response.status, path).toBe(500)
			expect(response.headers.getSetCookie(), path).toEqual([
				...committed
			])
		}
	})
})
