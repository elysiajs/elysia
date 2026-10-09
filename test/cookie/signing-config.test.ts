import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { Cookie } from '../../src/cookie/cookie'
import { compileCookieConfig } from '../../src/cookie/config'
import { parseCookieRaw, signCookieValues } from '../../src/cookie/utils'

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
			.error(({ error }) => {
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
