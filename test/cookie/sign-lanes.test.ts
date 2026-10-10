import { describe, expect, it } from 'bun:test'
import { Elysia, status, t } from '../../src'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle
} from '../differential/lanes'

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
				.onAfterResponse(() => {})
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
				.onAfterResponse(() => {})
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
				.onError(() => 'handled')
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

	// A root error or mapResponse hook runs on the error lane after the
	// route's own sign: it must still sign what it writes, and read the value
	// the route wrote, not its wire form. Registered before the route: a hook
	// reaches only the routes after it
	it('signs a cookie written by an error hook', async () => {
		let seen: unknown
		const app = withMe(
			new Elysia(config)
				.onError(({ cookie }: any) => {
					seen = cookie.session.value
					cookie.session.value = 'from-error'

					return 'handled'
				})
				.get('/login', ({ cookie: { session } }) => {
					session.value = 'user-42'

					throw new Error('boom')
				})
		)

		const result = await roundTrip(app, '/login')
		expect(seen).toBe('user-42')
		expect(result.me).toBe(200)
		expect(result.user).toBe('from-error')
	})

	it('signs a cookie written by an error hook that declines the error', async () => {
		const app = withMe(
			new Elysia(config)
				.onError(({ cookie }: any) => {
					if (cookie?.session) cookie.session.value = 'from-error'
				})
				.get('/login', ({ cookie: { session } }) => {
					session.value = 'user-42'

					throw new Error('boom')
				})
		)

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

	// `[null, secret]` verifies but has no key to sign with. An error hook's
	// answer then fails closed to the 500 fallback, never sent with its
	// cookie silently missing, and the cookie never leaves unsigned, as on
	// WebSocket
	it('fails closed when the cookie an error hook answers with fails to sign', async () => {
		for (const precompile of [false, true])
			for (const writer of [
				'handler',
				'hook',
				'hook after a throwing hook'
			] as const) {
				const write = (cookie: any) => {
					cookie.session.value = 'user-42'
					cookie.theme.value = 'dark'
				}

				const app = new Elysia({
					precompile,
					cookie: {
						secrets: [null, 'secret'] as any,
						sign: ['session']
					}
				})
					.onError(({ error }: any) => {
						if (
							writer === 'hook after a throwing hook' &&
							!(error instanceof TypeError)
						)
							throw new TypeError('again')
					})
					.onError(({ cookie }: any) => {
						if (writer !== 'handler') write(cookie)

						return 'handled'
					})
					.get('/', ({ cookie }: any) => {
						if (writer === 'handler') write(cookie)

						throw new Error('boom')
					})

				const res = await app.handle(new Request('http://localhost/'))
				const pairs = (res.headers.get('set-cookie') ?? '')
					.split(/, (?=[^ ;]+=)/)
					.map((cookie) => cookie.split(';')[0])

				expect({
					precompile,
					writer,
					status: res.status,
					body: await res.text(),
					session: pairs.filter((pair) =>
						pair.startsWith('session=')
					),
					theme: pairs.filter((pair) => pair.startsWith('theme='))
				}).toEqual({
					precompile,
					writer,
					status: 500,
					body: expect.not.stringContaining('handled') as any,
					session: [],
					theme: ['theme=dark']
				})
			}
	})

	const sessions = (res: Response) =>
		(res.headers.get('set-cookie') ?? '')
			.split(/, (?=[^ ;]+=)/)
			.filter((cookie) => cookie.startsWith('session='))

	// A sign failure always ends on a dedicated 500, never on what an earlier
	// try of the hook answered, whatever its status
	it('ends a failed sign on a dedicated 500 after a retried hook', async () => {
		for (const precompile of [false, true])
			for (const code of [200, 401]) {
				let calls = 0
				const app = new Elysia({
					precompile,
					cookie: {
						secrets: [null, 'secret'] as any,
						sign: ['session']
					}
				})
					.onError(({ cookie }: any) => {
						if (++calls === 1)
							throw status(code as any, 'first answer')

						cookie.session.value = 'user-42'

						return 'second answer'
					})
					.get('/', ({ cookie }: any) => {
						void cookie

						throw new Error('boom')
					})

				const res = await app.handle(new Request('http://localhost/'))
				const body = await res.text()

				expect({
					precompile,
					code,
					status: res.status,
					answered: /first answer|second answer/.test(body),
					session: sessions(res)
				}).toEqual({
					precompile,
					code,
					status: 500,
					answered: false,
					session: []
				})
			}
	})

	// The failure is recorded per request, not on what the signer threw: a
	// frozen error or a primitive fails closed the same
	it('fails closed whatever the signer throws', async () => {
		const digest = (Bun as any).CryptoHasher.prototype.digest

		try {
			for (const thrown of [
				Object.freeze(new Error('signer down')),
				'signer down'
			])
				for (const lane of [
					'success',
					'error',
					'after a throwing hook'
				]) {
					;(Bun as any).CryptoHasher.prototype.digest = () => {
						throw thrown
					}

					let calls = 0
					const app = new Elysia({
						cookie: { secrets: 'secret', sign: ['session'] }
					})
						.onError(({ cookie }: any) => {
							calls++
							const throwing = lane === 'after a throwing hook'
							if (throwing && calls === 1)
								throw new TypeError('hook failed')

							// only the first answer writes: a retry has nothing
							// left to fail on
							if (calls === (throwing ? 2 : 1))
								cookie.session.value = 'user-42'

							return 'HOOK ANSWER'
						})
						.get('/', ({ cookie }: any) => {
							if (lane !== 'success') throw new Error('boom')

							cookie.session.value = 'user-42'

							return 'ok'
						})

					const res = await app.handle(
						new Request('http://localhost/')
					)

					expect({
						thrown: typeof thrown,
						lane,
						status: res.status,
						body: (await res.text()).includes('HOOK ANSWER'),
						session: sessions(res)
					}).toEqual({
						thrown: typeof thrown,
						lane,
						status: 500,
						body: false,
						session: []
					})
				}
		} finally {
			;(Bun as any).CryptoHasher.prototype.digest = digest
		}
	})

	// The success lane's sign fails, then a hook answers without writing a
	// cookie: nothing is left to sign, and the answer still fails closed on
	// every lane, for a streamed response too (signed once its first chunk
	// ran, on the afterResponse lane)
	it('fails closed when a hook answers after the success lane failed to sign', async () => {
		const digest = (Bun as any).CryptoHasher.prototype.digest
		const served: Record<string, unknown> = {}
		const expected: Record<string, unknown> = {}

		for (const lane of [jitHandle, precompileHandle, aotReconstructHandle])
			for (const stream of [false, true]) {
				const instance = await lane.make((app: any) =>
					new Elysia({ ...app['~config'], ...config })
						.onError(() => status(200, 'handled'))
						.onAfterResponse(stream ? () => {} : [])
						.get(
							'/',
							stream
								? function* ({ cookie }: any) {
										cookie.session.value = 'user-42'
										yield 'ok'
									}
								: ({ cookie }: any) => {
										cookie.session.value = 'user-42'

										return 'ok'
									}
						)
				)

				try {
					;(Bun as any).CryptoHasher.prototype.digest = () => {
						throw new Error('signer down')
					}

					const res = await instance.handle(
						new Request('http://localhost/')
					)
					const name = `${lane.id}${stream ? ' stream' : ''}`

					served[name] = {
						status: res.status,
						answered: (await res.text()) === 'handled',
						session: sessions(res)
					}
					expected[name] = {
						status: 500,
						answered: false,
						session: []
					}
				} finally {
					;(Bun as any).CryptoHasher.prototype.digest = digest
					await instance.dispose()
				}
			}

		expect(served).toEqual(expected)
	})

	// A bag that refuses the drop still never sends the cookie unsigned
	it('fails closed on a frozen cookie bag', async () => {
		const digest = (Bun as any).CryptoHasher.prototype.digest
		const app = new Elysia(config)
			.onError(() => status(200, 'handled'))
			.get('/', ({ cookie, set }: any) => {
				cookie.session.value = 'user-42'
				Object.freeze(set.cookie)

				return 'ok'
			})

		try {
			;(Bun as any).CryptoHasher.prototype.digest = () => {
				throw new Error('signer down')
			}

			const res = await app.handle(new Request('http://localhost/'))

			expect({
				status: res.status,
				answered: (await res.text()) === 'handled',
				session: sessions(res)
			}).toEqual({ status: 500, answered: false, session: [] })
		} finally {
			;(Bun as any).CryptoHasher.prototype.digest = digest
		}
	})

	// The failure is recorded off the cookies: one named like the record is
	// an ordinary cookie, and a healthy sign keeps the hook's answer
	it('keeps the hook answer for a cookie named ~signFailed', async () => {
		for (const name of ['~signFailed', 'regular'])
			for (const answer of ['returns', 'throws']) {
				const app = new Elysia(config)
					.onError(() => {
						if (answer === 'throws') throw status(418, 'teapot')

						return status(418, 'teapot')
					})
					.get('/', ({ cookie }: any) => {
						cookie[name].value = 'ordinary'
						cookie.session.value = 'user-42'

						throw new Error('boom')
					})

				const res = await app.handle(new Request('http://localhost/'))

				expect({
					name,
					answer,
					status: res.status,
					body: await res.text(),
					session: sessions(res).length
				}).toEqual({
					name,
					answer,
					status: 418,
					body: 'teapot',
					session: 1
				})
			}
	})
})

// The same error-hook cases, plus secret rotation and an async mapResponse,
// on the lanes that sign asynchronously (WebCrypto, frozen AOT). Each lane runs
// in its own process: WebCrypto must be selected before the HMAC singleton loads
describe('error and mapResponse hooks sign on every lane', () => {
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
				expect(stdout.trim()).toBe(`85 ${lane} signing cases passed`)
			} finally {
				clearTimeout(timeout)
			}
		})
})
