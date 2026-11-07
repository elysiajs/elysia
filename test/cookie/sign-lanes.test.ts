import { describe, expect, it, spyOn } from 'bun:test'
import { Elysia, status, t } from '../../src'
import * as cookieUtils from '../../src/cookie/utils'
import { unsignCookie } from '../../src/cookie/crypto'
import { trace } from '../../src/plugin/trace'
import { websocket } from '../../src/plugin/websocket'
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
	const res = await app.handle(
		new Request(`http://localhost${path}`, { method })
	)
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
			new Elysia(config).get(
				'/login',
				({ cookie: { session }, defer }) => {
					session.value = 'user-42'
					defer(() => {})

					return 'ok'
				}
			)
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
			new Elysia(config).get(
				'/login',
				({ cookie: { session }, status }) => {
					session.value = 'user-42'

					throw status(409, 'conflict')
				}
			)
		)

		expect((await roundTrip(app, '/login')).status).toBe(409)
		expect((await roundTrip(app, '/login')).me).toBe(200)
	})

	it('signs on an async rejection without an error hook', async () => {
		const app = withMe(
			new Elysia(config).get(
				'/login',
				async ({ cookie: { session } }) => {
					session.value = 'user-42'
					await Promise.resolve()

					throw new Error('boom')
				}
			)
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

// A cookie the app is configured to sign must never leave unsigned, whichever
// exit the request takes. Before any route matches, there is no route signer:
// a 404, an onRequest answer or throw sign by the app-level cookie config. A
// hook there has no jar, it writes `set.cookie`
describe('signed cookies on exits no route answers', () => {
	const write = ({ set }: any) => {
		set.cookie = {
			session: { value: 'user-42' },
			theme: { value: 'dark' }
		}
	}

	const early = (hook: (context: any) => unknown) => (app: any) =>
		app.onRequest(hook).get('/', () => 'route')

	const exits: [name: string, path: string, wire: (app: any) => any][] = [
		['404', '/missing', early(write)],
		[
			'404 answered by onError',
			'/missing',
			(app) => early(write)(app).onError(() => 'handled')
		],
		[
			'404 written by onError',
			'/missing',
			(app) =>
				app
					.get('/', () => 'route')
					.onError((context: any) => {
						write(context)
					})
		],
		[
			'404 with a mapResponse hook',
			'/missing',
			(app) => early(write)(app).mapResponse(() => {})
		],
		[
			'sync onRequest answer',
			'/',
			early((context) => {
				write(context)

				return 'early'
			})
		],
		[
			'async onRequest answer',
			'/',
			early(async (context) => {
				write(context)

				return 'early'
			})
		],
		[
			// no cookie until mapping: the answer must not skip the signer
			'onRequest answer whose mapResponse writes the cookie',
			'/',
			(app) =>
				early(() => 'early')(app).mapResponse((context: any) => {
					write(context)
				})
		],
		[
			'onRequest answer whose mapResponse rejects',
			'/',
			(app) =>
				early((context) => {
					write(context)

					return 'early'
				})(app)
					// rejects mapping the answer only, so onError's reply maps
					.mapResponse(async ({ responseValue }: any) => {
						if (responseValue === 'early')
							throw new Error('map failed')
					})
					.onError(() => 'handled')
		],
		[
			'onRequest throw handled by onError',
			'/',
			(app) =>
				early((context) => {
					write(context)

					throw new Error('boom')
				})(app).onError(() => 'handled')
		],
		[
			'onRequest rejection handled by onError',
			'/',
			(app) =>
				early(async (context) => {
					write(context)

					throw new Error('boom')
				})(app).onError(() => 'handled')
		],
		[
			'traced onRequest answer',
			'/',
			(app) =>
				early((context) => {
					write(context)

					return 'early'
				})(app.use(trace()).trace(() => {}))
		],
		[
			'traced 404',
			'/missing',
			(app) => early(write)(app.use(trace()).trace(() => {}))
		]
	]

	const pairs = (res: Response) =>
		res.headers.getSetCookie().map((cookie) => cookie.split(';')[0])

	it('signs as a matched route signs the same value', async () => {
		const config = { cookie: { secrets: 'secret', sign: ['session'] } }

		const route = await new Elysia(config)
			.get('/', ({ cookie: { session } }) => {
				session.value = 'user-42'

				return 'ok'
			})
			.handle(new Request('http://localhost/'))
		const signed = pairs(route)[0]!
		expect(signed).toStartWith('session=user-42.')

		const results = []
		for (const [name, path, wire] of exits) {
			const res = await wire(new Elysia(config)).handle(
				new Request(`http://localhost${path}`)
			)

			results.push(`${name}: ${pairs(res).join(' ')}`)
		}

		expect(results).toEqual(
			exits.map(([name]) => `${name}: ${signed} theme=dark`)
		)
	})

	// `[null, secret]` verifies but has no key to sign with: the exit fails
	// closed to the dedicated 500, the signed cookie dropped, never unsigned
	it('fails closed when the cookie fails to sign', async () => {
		const results = []
		for (const [name, path, wire] of exits) {
			const res = await wire(
				new Elysia({
					cookie: {
						secrets: [null, 'secret'] as any,
						sign: ['session']
					}
				})
			).handle(new Request(`http://localhost${path}`))
			const body = await res.text()

			const answered = /early|handled/.test(body) ? ' answered' : ''

			results.push(
				`${name}: ${res.status}${answered} ${pairs(res).join(' ')}`
			)
		}

		// `theme` is not signed, it is sent as written
		expect(results).toEqual(
			exits.map(([name]) => `${name}: 500 theme=dark`)
		)
	})

	// `sign` without any secret has nothing to sign with: a cookie route fails
	// to compile, a no-route exit must not fall back to sending it unsigned
	it('fails closed when the app signs without a secret', async () => {
		const results = []
		for (const [name, path, wire] of exits) {
			const res = await wire(
				new Elysia({ cookie: { sign: ['session'] } })
			).handle(new Request(`http://localhost${path}`))

			results.push(`${name}: ${res.status} ${pairs(res).join(' ')}`)
		}

		expect(results).toEqual(
			exits.map(([name]) => `${name}: 500 theme=dark`)
		)
	})

	// The failure cleanup must not rely on objects user code can lock: a `set`
	// made non-extensible cannot take the `~signFailed` mark, a cookie bag
	// whose delete trap throws keeps the cookie. Either way a failed sign ends
	// on the dedicated 500 (onError does not answer it) with the signed cookie
	// dropped, on a matched route as on the exits no route answers
	it('fails closed when set or the cookie bag refuses the cleanup', async () => {
		const bag = () =>
			new Proxy(
				{ session: { value: 'user-42' }, theme: { value: 'dark' } },
				{
					deleteProperty() {
						throw new Error('no delete')
					}
				}
			)
		const locks = {
			'set non-extensible': (set: any) => {
				set.cookie = {
					session: { value: 'user-42' },
					theme: { value: 'dark' }
				}
				Object.preventExtensions(set)
			},
			'bag delete throws': (set: any) => {
				set.cookie = bag()
			}
		}

		// the hook comes first: it reaches only the routes after it
		const app = () =>
			new Elysia({
				cookie: { secrets: [null, 'secret'] as any, sign: ['session'] }
			}).onError(() => 'handled')

		const results = []
		for (const [lock, write] of Object.entries(locks))
			for (const [exit, path, build] of [
				[
					'matched',
					'/',
					() =>
						app().get('/', ({ set, cookie }) => {
							void cookie
							write(set)

							return 'route'
						})
				],
				[
					'404',
					'/missing',
					() =>
						app()
							.onRequest(({ set }) => write(set))
							.get('/', () => 'route')
				],
				[
					'onRequest answer',
					'/',
					() =>
						app()
							.onRequest(({ set }) => {
								write(set)

								return 'early'
							})
							.get('/', () => 'route')
				]
			] as const) {
				const res = await build().handle(
					new Request(`http://localhost${path}`)
				)
				const answered =
					(await res.text()) === 'handled' ? ' answered' : ''

				results.push(
					`${lock}, ${exit}: ${res.status}${answered} ${pairs(res).join(' ')}`
				)
			}

		expect(results).toEqual([
			// known gap: the route's inline error lane re-signs without reading
			// the mark off the copy, so its hook answers the 500. The signed
			// cookie is still dropped, never sent unsigned
			'set non-extensible, matched: 500 answered theme=dark',
			'set non-extensible, 404: 500 theme=dark',
			'set non-extensible, onRequest answer: 500 theme=dark',
			'bag delete throws, matched: 500 theme=dark',
			'bag delete throws, 404: 500 theme=dark',
			'bag delete throws, onRequest answer: 500 theme=dark'
		])
	})

	// Signing only takes over a failed sign. An error hook that throws on a
	// 404 is the root lane's 500 whether or not the app signs cookies, as on a
	// matched route; signing config must not turn it back into the 404
	it('keeps the 500 of a throwing error hook', async () => {
		const results = []
		for (const cookie of [
			undefined,
			{ secrets: 'secret', sign: ['session'] }
		])
			for (const onError of [
				() => {
					throw new Error('hook failed')
				},
				async () => {
					throw new Error('hook failed')
				}
			]) {
				const res = await new Elysia({ cookie })
					.onError(onError)
					.get('/', () => 'route')
					.handle(new Request('http://localhost/missing'))

				results.push(`${res.status} ${pairs(res).join(' ')}`)
			}

		expect(results).toEqual(['500 ', '500 ', '500 ', '500 '])
	})

	// The root signer is built once per app: a request that sets no cookie
	// pays one check, never a call into the signer
	it('does no signing work when no cookie was set', async () => {
		const sign = spyOn(cookieUtils, 'signCookieValues')

		try {
			const app = new Elysia({
				cookie: { secrets: 'secret', sign: ['session'] }
			})
				.onRequest(({ request, set }) => {
					if (request.url.endsWith('/write'))
						set.cookie = { session: { value: 'user-42' } }

					if (request.url.endsWith('/early')) return 'early'
					if (request.url.endsWith('/throw')) throw new Error('boom')
				})
				.onError(() => 'handled')
				.get('/', () => 'route')

			for (const [path, code] of [
				['/missing', 404],
				['/early', 200],
				['/throw', 500]
			] as const) {
				const res = await app.handle(
					new Request(`http://localhost${path}`)
				)
				expect(res.status).toBe(code)
				expect(res.headers.getSetCookie()).toEqual([])
			}
			expect(sign).toHaveBeenCalledTimes(0)

			// positive control: the spy sees the signer the exits call
			await app.handle(new Request('http://localhost/write'))
			expect(sign).toHaveBeenCalledTimes(1)
		} finally {
			sign.mockRestore()
		}
	})
})

// `set.cookie` writes a cookie without reading `cookie`, and it is the only
// cookie writer an onRequest hook has. Such a route gets no cookie jar, but
// the app still signs what it writes: a session sent unsigned is rejected on
// the next request, or worse, trusted by a reader that does not verify it
describe('signed cookies written through set.cookie on a matched route', () => {
	const write = (set: any) => {
		set.cookie = {
			session: { value: 'user-42' },
			theme: { value: 'dark' }
		}
	}

	const writers: [name: string, path: string, wire: (app: any) => any][] = [
		[
			'handler',
			'/',
			(app) =>
				app.get('/', ({ set }: any) => {
					write(set)

					return 'ok'
				})
		],
		[
			'async handler',
			'/',
			(app) =>
				app.get('/', async ({ set }: any) => {
					await Promise.resolve()
					write(set)

					return 'ok'
				})
		],
		[
			'generator handler',
			'/',
			(app) =>
				app.get('/', function* ({ set }: any) {
					write(set)
					yield 'ok'
				})
		],
		[
			'onRequest',
			'/',
			(app) =>
				app.onRequest(({ set }: any) => write(set)).get('/', () => 'ok')
		],
		[
			'transform',
			'/',
			(app) =>
				app.get(
					'/',
					{ transform: ({ set }: any) => write(set) },
					() => 'ok'
				)
		],
		[
			'beforeHandle',
			'/',
			(app) =>
				app.get(
					'/',
					{ beforeHandle: ({ set }: any) => write(set) },
					() => 'ok'
				)
		],
		[
			'afterHandle',
			'/',
			(app) =>
				app.get(
					'/',
					{ afterHandle: ({ set }: any) => write(set) },
					() => 'ok'
				)
		],
		[
			'mapResponse',
			'/',
			(app) =>
				app.get(
					'/',
					{ mapResponse: ({ set }: any) => write(set) },
					() => 'ok'
				)
		],
		[
			'error hook',
			'/',
			(app) =>
				app.get(
					'/',
					{
						error: ({ set }: any) => {
							write(set)

							return 'handled'
						}
					},
					() => {
						throw new Error('boom')
					}
				)
		],
		[
			'derive',
			'/',
			(app) =>
				app
					.derive(({ set }: any) => {
						write(set)

						return {}
					})
					.get('/', () => 'ok')
		],
		[
			'global hook of a plugin',
			'/',
			(app) =>
				app
					.use(
						new Elysia({ name: 'writer' }).onBeforeHandle(
							'global',
							({ set }: any) => write(set)
						)
					)
					.get('/', () => 'ok')
		],
		[
			'macro beforeHandle',
			'/',
			(app) =>
				app
					.macro({
						writes: { beforeHandle: ({ set }: any) => write(set) }
					})
					.get('/', { writes: true }, () => 'ok')
		],
		[
			'aliased set',
			'/',
			(app) =>
				app.get('/', (c: any) => {
					const set = c.set
					write(set)

					return 'ok'
				})
		],
		[
			'computed key',
			'/',
			(app) =>
				app.get('/', (c: any) => {
					write(c['se' + 't'])

					return 'ok'
				})
		],
		[
			'static value route',
			'/',
			(app) => app.onRequest(({ set }: any) => write(set)).get('/', 'ok')
		],
		[
			'mount',
			'/m/x',
			(app) =>
				app
					.onRequest(({ set }: any) => write(set))
					.mount('/m', () => new Response('mounted'))
		]
	]

	const pairs = (res: Response) =>
		res.headers.getSetCookie().map((cookie) => cookie.split(';')[0]!)

	// the `session` value as the next request reads it with `secret`: false
	// when it left unsigned
	const read = async (res: Response, secret = 'secret') => {
		const pair = pairs(res).find((p) => p.startsWith('session='))
		if (!pair) return 'missing'

		return unsignCookie(
			decodeURIComponent(pair.slice('session='.length)),
			secret,
			'session'
		)
	}

	it('signs every writer on every compiled lane', async () => {
		const results: string[] = []
		const expected: string[] = []

		for (const lane of [jitHandle, precompileHandle, aotReconstructHandle])
			for (const [name, path, wire] of writers) {
				const instance = await lane.make((app: any) =>
					wire(new Elysia({ ...app['~config'], ...config }))
				)

				try {
					const res = await instance.handle(
						new Request(`http://localhost${path}`)
					)

					results.push(
						`${lane.id} ${name}: ${await read(res)} ${pairs(res)
							.filter((p) => p.startsWith('theme='))
							.join(' ')}`
					)
					expected.push(`${lane.id} ${name}: user-42 theme=dark`)
				} finally {
					await instance.dispose()
				}
			}

		expect(results).toEqual(expected)
	})

	// a native static route runs no JS, so only the routes Bun serves through
	// the compiled handler can write: mount, a static value behind onRequest,
	// and a refused WebSocket upgrade, which answers with HTTP
	it('signs over a real socket, a refused WebSocket upgrade included', async () => {
		const upgrade = {
			upgrade: 'websocket',
			connection: 'Upgrade',
			'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
			'sec-websocket-version': '13'
		}

		const results: string[] = []
		for (const [name, path, wire, headers] of [
			...writers
				.filter(([name]) =>
					['static value route', 'mount', 'onRequest'].includes(name)
				)
				.map(([name, path, wire]) => [name, path, wire, {}] as const),
			[
				'refused WebSocket upgrade',
				'/ws',
				(app: any) =>
					app.use(websocket()).ws('/ws', {
						beforeHandle: ({ set, status }: any) => {
							write(set)

							return status(401, 'no')
						},
						message() {}
					}),
				upgrade
			] as const
		]) {
			const app = wire(new Elysia(config)).listen(0)

			try {
				const res = await fetch(
					`http://localhost:${app.server!.port}${path}`,
					{ headers }
				)

				results.push(`${name}: ${res.status} ${await read(res)}`)
			} finally {
				await app.stop(true)
			}
		}

		expect(results).toEqual([
			'onRequest: 200 user-42',
			'static value route: 200 user-42',
			'mount: 200 user-42',
			'refused WebSocket upgrade: 401 user-42'
		])
	})

	// `[null, secret]` verifies but has no key to sign with: the route fails
	// closed to the dedicated 500, the signed cookie dropped, never unsigned
	it('fails closed when the cookie fails to sign', async () => {
		const results: string[] = []
		for (const [name, path, wire] of writers) {
			const res = await wire(
				new Elysia({
					cookie: {
						secrets: [null, 'secret'] as any,
						sign: ['session']
					}
				})
			).handle(new Request(`http://localhost${path}`))
			await res.text()

			results.push(`${name}: ${res.status} ${pairs(res).join(' ')}`)
		}

		expect(results).toEqual(
			writers.map(([name]) => `${name}: 500 theme=dark`)
		)
	})

	// `sign` without any secret has nothing to sign with: the route fails to
	// compile, as a route that reads `cookie` already did, and never falls back
	// to sending the cookie unsigned
	it('fails closed when the app signs without a secret', async () => {
		const results: string[] = []
		for (const [name, path, wire] of writers) {
			const res = await wire(
				new Elysia({ cookie: { sign: ['session'] } })
			).handle(new Request(`http://localhost${path}`))

			results.push(`${name}: ${res.status} ${await read(res)}`)
		}

		expect(results).toEqual(writers.map(([name]) => `${name}: 500 missing`))
	})

	// The config that signs is the route's own: a route schema's secret wins
	// over the app's, and a plugin's config signs its own routes even when the
	// app signs nothing
	it('signs with the route or plugin config that applies', async () => {
		const handler = ({ set }: any) => {
			write(set)

			return 'ok'
		}

		const route = await new Elysia(config)
			.get(
				'/',
				{
					cookie: t.Cookie(
						{},
						{ secrets: 'route', sign: ['session'] }
					)
				},
				handler
			)
			.handle(new Request('http://localhost/'))

		const plugin = await new Elysia()
			.use(
				new Elysia({
					name: 'signed',
					cookie: { secrets: 'plugin', sign: ['session'] }
				}).get('/', handler)
			)
			.handle(new Request('http://localhost/'))

		expect({
			route: await read(route, 'route'),
			'route, app secret': await read(route),
			plugin: await read(plugin, 'plugin')
		}).toEqual({
			route: 'user-42',
			'route, app secret': false,
			plugin: 'user-42'
		})
	})

	// Without signing the route pays nothing: no signer call, and the cookie
	// leaves exactly as written
	it('leaves an app that does not sign untouched', async () => {
		const sign = spyOn(cookieUtils, 'signCookieValues')

		try {
			const results: string[] = []
			for (const [name, path, wire] of writers) {
				const res = await wire(new Elysia()).handle(
					new Request(`http://localhost${path}`)
				)

				results.push(`${name}: ${pairs(res).join(' ')}`)
			}

			expect(results).toEqual(
				writers.map(([name]) => `${name}: session=user-42 theme=dark`)
			)
			expect(sign).toHaveBeenCalledTimes(0)

			// positive control: the spy sees the signer a signing route calls
			await writers[0]![2](new Elysia(config)).handle(
				new Request('http://localhost/')
			)
			expect(sign).toHaveBeenCalled()
		} finally {
			sign.mockRestore()
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
				[
					process.execPath,
					import.meta.dir + '/sign-lanes.fixture.ts',
					lane
				],
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
				expect(stdout.trim()).toBe(`138 ${lane} signing cases passed`)
			} finally {
				clearTimeout(timeout)
			}
		})
})
