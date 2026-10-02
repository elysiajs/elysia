import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'

// A signed cookie that leaves unsigned is rejected on the next request, so
// the user can never keep a session. Every compiled lane that can emit
// `set-cookie` must sign: success, error with and without an error hook,
// and the lanes selected by afterResponse / defer / an escaped context.

// I have nothing but my burger and I want nothing more
const config = { cookie: { secrets: 'secret', sign: ['session'] } }

const roundTrip = async (app: any, path: string, method = 'GET') => {
	const res = await app.handle(new Request(`http://localhost${path}`, { method }))
	const setCookie = res.headers.get('set-cookie')
	expect(setCookie).not.toBeNull()

	const pair = setCookie!.split(';')[0]!
	// Signed exactly once: `value.signature`
	expect(pair.split('.').length).toBe(2)

	const me = await app.handle(
		new Request('http://localhost/me', { headers: { cookie: pair } })
	)

	return { status: res.status, me: me.status, user: await me.text() }
}

const withMe = (app: any) =>
	app.get('/me', ({ cookie: { session } }: any) => String(session.value))

describe('signed cookies on every compiled lane', () => {
	it('signs on the afterResponse lane', async () => {
		const app = withMe(
			new Elysia(config)
				.afterResponse(() => {})
				.post('/login', ({ cookie: { session } }) => {
					session.value = 'user-42'

					return 'ok'
				})
		)

		expect(await roundTrip(app, '/login', 'POST')).toEqual({
			status: 200,
			me: 200,
			user: 'user-42'
		})
	})

	it('signs when the handler calls defer()', async () => {
		const app = withMe(
			new Elysia(config).get('/login', ({ cookie: { session }, defer }) => {
				session.value = 'user-42'
				defer(() => {})

				return 'ok'
			})
		)

		expect((await roundTrip(app, '/login')).me).toBe(200)
	})

	it('signs when the context escapes to a helper', async () => {
		const write = (c: any) => {
			c.cookie.session.value = 'user-42'

			return 'ok'
		}

		const app = withMe(new Elysia(config).get('/login', (c) => write(c)))

		expect((await roundTrip(app, '/login')).me).toBe(200)
	})

	it('signs on a thrown error without an error hook', async () => {
		const app = withMe(
			new Elysia(config).get('/login', ({ cookie: { session } }) => {
				session.value = 'user-42'

				throw new Error('boom')
			})
		)

		expect(await roundTrip(app, '/login')).toEqual({
			status: 500,
			me: 200,
			user: 'user-42'
		})
	})

	it('signs on a thrown status without an error hook', async () => {
		const app = withMe(
			new Elysia(config).get('/login', ({ cookie: { session }, status }) => {
				session.value = 'user-42'

				throw status(409, 'conflict')
			})
		)

		expect((await roundTrip(app, '/login')).status).toBe(409)
		expect((await roundTrip(app, '/login')).me).toBe(200)
	})

	it('signs on an async rejection without an error hook', async () => {
		const app = withMe(
			new Elysia(config).get('/login', async ({ cookie: { session } }) => {
				session.value = 'user-42'
				await Promise.resolve()

				throw new Error('boom')
			})
		)

		expect((await roundTrip(app, '/login')).me).toBe(200)
	})

	it('signs on a response validation failure', async () => {
		const app = withMe(
			new Elysia(config).get(
				'/login',
				{ response: t.Object({ ok: t.Boolean() }) },
				// @ts-expect-error invalid on purpose
				({ cookie: { session } }) => {
					session.value = 'user-42'

					return { ok: 'nope' }
				}
			)
		)

		expect((await roundTrip(app, '/login')).me).toBe(200)
	})

	it('signs on the afterResponse lane when the handler throws', async () => {
		const app = withMe(
			new Elysia(config)
				.afterResponse(() => {})
				.get('/login', ({ cookie: { session } }) => {
					session.value = 'user-42'

					throw new Error('boom')
				})
		)

		expect((await roundTrip(app, '/login')).me).toBe(200)
	})

	it('signs once when an error hook handles the error', async () => {
		const app = withMe(
			new Elysia(config)
				.error(() => 'handled')
				.get('/login', ({ cookie: { session } }) => {
					session.value = 'user-42'

					throw new Error('boom')
				})
		)

		expect(await roundTrip(app, '/login')).toEqual({
			status: 500,
			me: 200,
			user: 'user-42'
		})
	})

	it('signs once when serialization fails after the success lane signed', async () => {
		const app = withMe(
			new Elysia(config).get('/login', ({ cookie: { session } }) => {
				session.value = 'user-42'

				// JSON.stringify throws on BigInt while mapping the response
				return { n: 1n }
			})
		)

		const result = await roundTrip(app, '/login')
		expect(result.status).toBe(500)
		expect(result.me).toBe(200)
	})

	// A root error or mapResponse hook the route did not compile in runs in the
	// app-level error lane, after the route's own sign: it must still sign
	// what it writes, and read the value the route wrote, not its wire form
	it('signs a cookie written by an error hook registered after the route', async () => {
		let seen: unknown
		const app = withMe(
			new Elysia(config).get('/login', ({ cookie: { session } }) => {
				session.value = 'user-42'

				throw new Error('boom')
			})
		).error(({ cookie }: any) => {
			seen = cookie.session.value
			cookie.session.value = 'from-error'

			return 'handled'
		})

		const result = await roundTrip(app, '/login')
		expect(seen).toBe('user-42')
		expect(result.me).toBe(200)
		expect(result.user).toBe('from-error')
	})

	it('signs a cookie written by a late error hook that declines the error', async () => {
		const app = withMe(
			new Elysia(config).get('/login', ({ cookie: { session } }) => {
				session.value = 'user-42'

				throw new Error('boom')
			})
		).error(({ cookie }: any) => {
			if (cookie?.session) cookie.session.value = 'from-error'
		})

		const result = await roundTrip(app, '/login')
		expect(result.status).toBe(500)
		expect(result.user).toBe('from-error')
	})

	it('signs a cookie written by a root mapResponse hook on the error lane', async () => {
		const app = withMe(
			new Elysia(config)
				.mapResponse(({ cookie }: any) => {
					if (cookie) cookie.session.value = 'from-map'
				})
				.get('/login', ({ cookie: { session } }) => {
					session.value = 'user-42'

					throw new Error('boom')
				})
		)

		const res = await app.handle(new Request('http://localhost/login'))
		const pair = res.headers.get('set-cookie')!.split(';')[0]!
		expect(pair.split('.').length).toBe(2)
	})
})

// The same late-hook cases, plus secret rotation and an async mapResponse, on
// the lanes that sign asynchronously (WebCrypto, frozen AOT). Each lane runs in
// its own process: WebCrypto must be selected before the HMAC singleton loads
describe('late app-level hooks sign on every lane', () => {
	for (const lane of ['jit', 'subtle', 'aot'] as const)
		it(lane, async () => {
			const child = Bun.spawn(
				[process.execPath, import.meta.dir + '/sign-lanes.fixture.ts', lane],
				{ stdout: 'pipe', stderr: 'pipe' }
			)
			const timeout = setTimeout(() => child.kill(), 10_000)
			try {
				const [exit, stdout, stderr] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text()
				])
				expect(stderr).toBe('')
				expect(exit).toBe(0)
				expect(stdout.trim()).toBe(`29 ${lane} signing cases passed`)
			} finally {
				clearTimeout(timeout)
			}
		})
})
