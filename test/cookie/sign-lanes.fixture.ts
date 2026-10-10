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
const { hasSyncHmac, signCookie, unsignCookie } =
	await import('../../src/cookie/crypto')
const { Compiled } = await import('../../src/compile/aot')
const { Validator } = await import('../../src/validator')
const { endHandlerCapture, endValidatorCapture } =
	await import('../../src/compile/aot-capture')
const { materialise, materialiseHandlers, registerManifest } =
	await import('../aot/_manifest')

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
