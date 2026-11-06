// The error lane signs on every lane: a root `.onError()` and a root
// `mapResponse` both run after the route's own exit, so they must still sign
// what they write, with the first (current) secret, and read the value the
// route wrote. Each is registered before the route: a hook reaches only the
// routes after it
import assert from 'node:assert/strict'

const lane = process.argv[2] as 'jit' | 'subtle' | 'aot'
if (lane === 'subtle') {
	;(Bun as any).CryptoHasher = undefined
	;(process as any).getBuiltinModule = undefined
}

const { Elysia, t } = await import('../../src')
const { hasSyncHmac, signCookie, unsignCookie } = await import(
	'../../src/cookie/crypto'
)
const { Compiled } = await import('../../src/compile/aot')
const { Validator } = await import('../../src/validator')
const { endHandlerCapture, endValidatorCapture } = await import(
	'../../src/compile/aot-capture'
)
const { materialise, materialiseHandlers, registerManifest } = await import(
	'../aot/_manifest'
)

assert.equal(hasSyncHmac, lane !== 'subtle')

const make = (build: () => any) => {
	if (lane !== 'aot') return build().compile()

	process.env.ELYSIA_AOT_BUILD = '1'
	build().compile()
	const handlers = endHandlerCapture()
	const validators = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	// the rebuild must serve the captured code, not a fresh JIT compile
	assert.ok(handlers.length > 0)
	Validator.clear()
	registerManifest({
		handlers: materialiseHandlers(handlers),
		validators: materialise(validators)
	})
	const app = build().compile()
	Compiled.clear()
	Validator.clear()

	return app
}

let cases = 0
const failures: string[] = []
const check = (actual: unknown, expected: unknown, name: string) => {
	cases++
	if (actual !== expected)
		failures.push(`${name}: ${String(actual)} !== ${String(expected)}`)
}

const config = { cookie: { secrets: 's', sign: ['session'] } }

// the emitted `session` value, verified against `secret`: false if unsigned
const emitted = async (res: Response, secret = 's') => {
	const pair = res.headers.get('set-cookie')?.split(';')[0]
	if (!pair?.startsWith('session=')) return 'missing'

	return unsignCookie(
		decodeURIComponent(pair.slice('session='.length)),
		secret,
		'session'
	)
}

const throwing = ({ cookie: { session } }: any) => {
	session.value = 'user-42'
	throw new Error('boom')
}

// an error hook that writes and handles
{
	let seen: unknown
	const app = make(() =>
		new Elysia(config)
			.onError(({ cookie }: any) => {
				seen = cookie.session.value
				cookie.session.value = 'from-error'
				return 'handled'
			})
			.get('/', throwing)
	)
	const res = await app.handle(new Request('http://localhost/'))
	check(await emitted(res), 'from-error', 'error hook writes')
	check(seen, 'user-42', 'error hook reads the plain value')
}

// an error hook that writes and declines
{
	const app = make(() =>
		new Elysia(config)
			.onError(({ cookie }: any) => {
				cookie.session.value = 'from-error'
			})
			.get('/', throwing)
	)
	const res = await app.handle(new Request('http://localhost/'))
	check(res.status, 500, 'error hook declines: status')
	check(await emitted(res), 'from-error', 'error hook declines')
}

// a root mapResponse, sync and async, on the hookless error lane
for (const async of [false, true]) {
	const app = make(() =>
		new Elysia(config)
			.mapResponse(
				async
					? async ({ cookie }: any) => {
							await Promise.resolve()
							cookie.session.value = 'from-map'
						}
					: ({ cookie }: any) => {
							cookie.session.value = 'from-map'
						}
			)
			.get('/', throwing)
	)
	const res = await app.handle(new Request('http://localhost/'))
	check(
		await emitted(res),
		'from-map',
		`${async ? 'async' : 'sync'} root mapResponse`
	)
}

// secret rotation: a cookie signed with the old secret is re-issued with the
// current one when an error hook touches it
{
	let seen: unknown
	const app = make(() =>
		new Elysia({
			cookie: { secrets: ['new-secret', 'old-secret'], sign: ['session'] }
		})
			.onError(({ cookie }: any) => {
				seen = cookie.session.value
				cookie.session.update({ maxAge: 10 })
				return 'handled'
			})
			.get('/', ({ cookie: { session } }: any) => {
				void session.value
				throw new Error('boom')
			})
	)
	const old = await signCookie('rotated-user', 'old-secret', 'session')
	const res = await app.handle(
		new Request('http://localhost/', {
			headers: { cookie: `session=${encodeURIComponent(old)}` }
		})
	)
	check(seen, 'rotated-user', 'rotation: hook reads the plain value')
	const pair = res.headers.get('set-cookie') ?? ''
	check(
		await emitted(res, 'new-secret'),
		'rotated-user',
		'rotation: new secret'
	)
	check(
		await emitted(res, 'old-secret'),
		false,
		'rotation: not the old secret'
	)
	check(pair.split(';')[0]!.split('.').length, 2, 'rotation: signed once')
}

// No route answers a 404 or an onRequest answer: the app-level cookie config
// signs there, and must on the asynchronous (subtle) lane too. A hook there
// has no jar, it writes `set.cookie`
const writeSet = ({ set }: any) => {
	set.cookie = { session: { value: 'user-42' } }
}
const early =
	(hook: (context: any) => unknown) =>
	(app: any): any =>
		app.onRequest(hook).get('/', () => 'route')
{
	const exits: [name: string, path: string, build: () => any][] = [
		['404', '/missing', () => early(writeSet)(new Elysia(config))],
		[
			'404 answered by onError',
			'/missing',
			() => early(writeSet)(new Elysia(config)).onError(() => 'handled')
		],
		[
			'sync onRequest answer',
			'/',
			() =>
				early((c) => {
					writeSet(c)
					return 'early'
				})(new Elysia(config))
		],
		[
			'async onRequest answer',
			'/',
			() =>
				early(async (c) => {
					writeSet(c)
					return 'early'
				})(new Elysia(config))
		],
		[
			'onRequest answer whose mapResponse writes the cookie',
			'/',
			() => early(() => 'early')(new Elysia(config)).mapResponse(writeSet)
		],
		[
			'onRequest throw handled by onError',
			'/',
			() =>
				early((c) => {
					writeSet(c)
					throw new Error('boom')
				})(new Elysia(config)).onError(() => 'handled')
		]
	]

	for (const [name, path, build] of exits) {
		const res = await make(build).handle(
			new Request(`http://localhost${path}`)
		)
		check(await emitted(res), 'user-42', `${name}: signed`)
	}
}

// A mapResponse hook replaces `set.cookie` while the asynchronous sign of the
// old bag is pending, and the response serializes the bag `set` holds after.
// What is sent must be what was signed: the replacement signed, never sent
// unsigned. A synchronous sign serializes before the replacement lands
{
	const replace = ({ set }: any) => {
		queueMicrotask(() => {
			set.cookie = { session: { value: 'replacement' } }
		})
	}
	const racing: [name: string, build: () => any][] = [
		[
			'matched route',
			() =>
				new Elysia(config)
					.mapResponse(replace)
					.get('/', ({ cookie: { session } }: any) => {
						session.value = 'user-42'
						return 'ok'
					})
		],
		[
			'onRequest answer',
			() =>
				early((c) => {
					writeSet(c)
					return 'early'
				})(new Elysia(config).mapResponse(replace))
		],
		[
			'onRequest throw handled by onError',
			() =>
				early((c) => {
					writeSet(c)
					throw new Error('boom')
				})(new Elysia(config).mapResponse(replace)).onError(
					() => 'handled'
				)
		]
	]

	for (const [name, build] of racing) {
		const res = await make(build).handle(new Request('http://localhost/'))
		// `replacement` on subtle proves the swap landed mid-sign
		check(
			await emitted(res),
			lane === 'subtle' ? 'replacement' : 'user-42',
			`${name}: bag replaced while signing`
		)
	}
}

// `set.cookie` written on a route that never reads `cookie`: the route has no
// jar, yet it signs. On subtle and aot the signer is asynchronous and a sync
// route chains it onto its response, each exit of it: the handler's, the
// afterResponse lane's and an error hook's answer. A failed sign still drops
// the session, never sends it unsigned
{
	// `session` alone: `emitted` reads the first set-cookie pair
	const write = (set: any) => {
		set.cookie = { session: { value: 'user-42' } }
	}

	const writers: Record<string, (app: any) => any> = {
		handler: (app) =>
			app.get('/', ({ set }: any) => {
				write(set)

				return 'ok'
			}),
		'generator handler': (app) =>
			app.get('/', function* ({ set }: any) {
				write(set)
				yield 'ok'
			}),
		onRequest: (app) =>
			app.onRequest(({ set }: any) => write(set)).get('/', () => 'ok'),
		'error hook': (app) =>
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
			),
		'static value route': (app) =>
			app.onRequest(({ set }: any) => write(set)).get('/', 'ok'),
		'handler on the afterResponse lane': (app) =>
			app
				.onAfterResponse(() => {})
				.get('/', ({ set }: any) => {
					write(set)

					return 'ok'
				}),
		'handler answered by an error hook': (app) =>
			app
				.onError(() => 'handled')
				.get('/', ({ set }: any) => {
					write(set)

					throw new Error('boom')
				}),
		'handler an error hook declines': (app) =>
			app
				.onError(() => {})
				.get('/', ({ set }: any) => {
					write(set)

					throw new Error('boom')
				}),
		// a sync handler's pending value writes after the route returned:
		// every lane's signer waits for it to settle. Signing before it left
		// the cookie unsigned on jit, and a failed sign answered 200
		'pending value of a sync handler': (app) =>
			app.get('/', ({ set }: any) =>
				Promise.resolve().then(() => {
					write(set)

					return 'ok'
				})
			)
	}

	for (const [name, wire] of Object.entries(writers)) {
		const signed = make(() => wire(new Elysia(config)))
		const res = await signed.handle(new Request('http://localhost/'))
		check(await emitted(res), 'user-42', `set.cookie by ${name}: signed`)

		const failed = make(() =>
			wire(
				new Elysia({
					cookie: { secrets: [null, 's'] as any, sign: ['session'] }
				})
			)
		)
		const closed = await failed.handle(new Request('http://localhost/'))
		await closed.text()
		check(closed.status, 500, `set.cookie by ${name}: failed sign status`)
		check(
			await emitted(closed),
			'missing',
			`set.cookie by ${name}: failed sign drops the session`
		)
	}

	// Every route of a signing app may write `set.cookie`, so every one signs.
	// A route that writes no cookie must not pay a Promise for it: turning
	// async cost ~105 ns per request (+40%) on an AOT build
	const { setOnEmit } = await import('../../src/compile/handler/jit')
	const sources: string[] = []
	setOnEmit((code) => sources.push(code))
	try {
		const res = await make(() =>
			new Elysia(config).get('/:id', ({ params }: any) => params.id)
		).handle(new Request('http://localhost/1'))
		check(await res.text(), '1', 'cookie-free route: answers')
	} finally {
		setOnEmit(undefined)
	}
	check(sources.length > 0, true, 'cookie-free route: compiled')
	check(
		sources.some((code) => code.includes('async function route(')),
		false,
		'cookie-free route: stays sync'
	)
}

// The documented jar, from a sync handler's pending value: the session it
// writes once it settles is signed, a write before the return is overwritten
// by it, never sent in its place, and a failed sign drops it. On jit the sync
// signer ran before the value settled: unsigned, the stale value, or 200
{
	const routes: Record<string, (context: any) => unknown> = {
		'jar write after settling': ({ cookie: { session } }: any) =>
			Promise.resolve().then(() => {
				session.value = 'user-42'

				return 'ok'
			}),
		'jar overwrite after settling': ({ cookie: { session } }: any) => {
			session.value = 'stale'

			return Promise.resolve().then(() => {
				session.value = 'user-42'

				return 'ok'
			})
		}
	}

	for (const [name, handler] of Object.entries(routes)) {
		const res = await make(() =>
			new Elysia(config).get('/', handler)
		).handle(new Request('http://localhost/'))
		check(await res.text(), 'ok', `${name}: answers`)
		check(await emitted(res), 'user-42', `${name}: signed`)

		const closed = await make(() =>
			new Elysia({
				cookie: { secrets: [null, 's'] as any, sign: ['session'] }
			}).get('/', handler)
		).handle(new Request('http://localhost/'))
		await closed.text()
		check(closed.status, 500, `${name}: failed sign status`)
		check(
			await emitted(closed),
			'missing',
			`${name}: failed sign drops the session`
		)
	}
}

// Signing rewrites a cookie's value to its wire form, so it must wait for a
// sync handler's pending value: a continuation that reads the cookie back
// must see what the app wrote. On jit the sync signer ran first and the
// continuation extended the signed string ('seed.<HMAC>-next')
{
	const routes: Record<string, (context: any) => unknown> = {
		'jar read back after settling': ({ cookie: { session } }: any) => {
			session.value = 'seed'

			return Promise.resolve().then(() => {
				session.value += '-next'

				return 'ok'
			})
		},
		'set.cookie read back after settling': ({ set }: any) => {
			set.cookie = { session: { value: 'seed' } }

			return Promise.resolve().then(() => {
				set.cookie.session.value += '-next'

				return 'ok'
			})
		}
	}

	for (const [name, handler] of Object.entries(routes)) {
		const res = await make(() =>
			new Elysia(config).get('/', handler)
		).handle(new Request('http://localhost/'))
		check(await res.text(), 'ok', `${name}: answers`)
		check(await emitted(res), 'seed-next', `${name}: signed as written`)
	}

	// the pending value rejects after a write made before the return: the
	// error exit still signs that write (or drops it), never sends it raw
	const rejected = make(() =>
		new Elysia(config).get('/', ({ cookie: { session } }: any) => {
			session.value = 'user-42'

			return Promise.resolve().then(() => {
				throw new Error('boom')
			})
		})
	)
	const res = await rejected.handle(new Request('http://localhost/'))
	await res.text()
	check(res.status, 500, 'rejected pending value: status')
	const value = await emitted(res)
	check(
		value === 'user-42' || value === 'missing',
		true,
		`rejected pending value: signed or dropped, got ${String(value)}`
	)
}

// Signing fails closed: when the signer throws or rejects (an HSM or WebCrypto
// outage), a cookie meant to be signed is dropped instead of leaving unsigned,
// the error response still goes out and an unsigned cookie is kept. Runs last,
// the failure is process-wide
{
	const write = (cookie: any) => {
		cookie.session.value = 'raw-secret'
		cookie.theme.value = 'dark'
	}
	const invalid = t.Object({ ok: t.Boolean() })
	const apps = {
		// the success lane's own signer and a route-local error hook's signer
		success: make(() =>
			new Elysia(config).get('/', ({ cookie }: any) => {
				write(cookie)
				return 'ok'
			})
		),
		'local error hook': make(() =>
			new Elysia(config)
				.onError(() => 'handled')
				.get('/', ({ cookie }: any) => {
					write(cookie)
					throw new Error('boom')
				})
		),
		'error hook writes': make(() =>
			new Elysia(config)
				.onError(({ cookie }: any) => {
					write(cookie)
					return 'handled'
				})
				.get('/', ({ cookie }: any) => {
					void cookie
					throw new Error('boom')
				})
		),
		'validation error': make(() =>
			new Elysia(config).get('/', { response: invalid }, (({
				cookie
			}: any) => {
				write(cookie)
				return { ok: 'no' }
			}) as any)
		),
		'validation error, error hook': make(() =>
			new Elysia(config)
				.onError(() => 'handled')
				.get('/', { response: invalid }, (({ cookie }: any) => {
					write(cookie)
					return { ok: 'no' }
				}) as any)
		),
		// the hook writes nothing, so nothing is left to sign
		'hook answers after the success lane failed': make(() =>
			new Elysia(config)
				.onError(() => 'handled')
				.get('/', ({ cookie }: any) => {
					write(cookie)
					return 'ok'
				})
		)
	}

	// the hook swaps the cookies out before the sign settles: the failure
	// is recorded on the request, not on the cookies it replaced
	const replacing = (replacement: () => unknown) =>
		make(() =>
			new Elysia(config)
				.onError(({ cookie, set }: any) => {
					write(cookie)
					queueMicrotask(() => {
						set.cookie = replacement()
					})

					return 'handled'
				})
				.get('/', ({ cookie }: any) => {
					void cookie
					throw new Error('boom')
				})
		)
	const replaced = {
		'hook replaces the cookies with {}': replacing(() => ({})),
		'hook replaces the cookies with undefined': replacing(() => undefined)
	}

	// what the signer throws doesn't matter, a frozen error or a primitive
	// included: the failure is recorded per request
	for (const thrown of [
		new Error('signer down'),
		Object.freeze(new Error('signer down')),
		'signer down'
	])
		for (const [name, app] of Object.entries(apps)) {
			if (lane === 'subtle')
				crypto.subtle.sign = () => Promise.reject(thrown)
			else
				(Bun as any).CryptoHasher.prototype.digest = () => {
					throw thrown
				}

			const res = await app.handle(new Request('http://localhost/'))
			const setCookie = res.headers.get('set-cookie') ?? ''
			check(
				/(^|, )session=/.test(setCookie),
				false,
				`${name}: no unsigned session`
			)
			check(
				/(^|, )theme=dark/.test(setCookie),
				true,
				`${name}: unsigned cookie kept`
			)
			// On the success lane the signer's failure is the error (a 500), and
			// an error hook's answer fails closed to the 500 fallback, never sent
			// with its cookie silently missing. Without a hook, the response the
			// error lane chose goes out unchanged
			const body = await res.text()
			check(res.status, 500, `${name}: status`)
			if (name === 'validation error')
				check(
					body.includes('signer down'),
					false,
					`${name}: error response kept`
				)
			else if (name !== 'success')
				check(
					body === 'handled',
					false,
					`${name}: hook response replaced`
				)
		}

	for (const [name, app] of Object.entries(replaced)) {
		const res = await app.handle(new Request('http://localhost/'))
		check(
			/(^|, )session=/.test(res.headers.get('set-cookie') ?? ''),
			false,
			`${name}: no unsigned session`
		)
		check(res.status, 500, `${name}: status`)
		check(
			(await res.text()) === 'handled',
			false,
			`${name}: hook response replaced`
		)
	}
}

if (failures.length) {
	console.error(failures.join('\n'))
	process.exit(1)
}

console.log(`${cases} ${lane} signing cases passed`)
