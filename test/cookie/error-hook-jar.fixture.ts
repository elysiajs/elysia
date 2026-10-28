// An error hook is typed with `cookie` and may read it on any error. A request
// that fails parse, transform or validation never reaches the route's own jar,
// so the error hook must still get one: without it a type-correct hook throws
// on `cookie.sid` and a 422 goes out as a 500. Signed cookies stay verified
// there: a forged value must never reach the hook. Run per lane (sync HMAC,
// WebCrypto, AOT replay): each emits its own catch
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

const request = (path: string, cookie: string, init: RequestInit = {}) =>
	new Request(`http://localhost${path}`, {
		...init,
		headers: { cookie, ...(init.headers as any) }
	})

const readSid = ({ cookie }: any) => ({ sid: cookie.sid.value ?? null })

// unsigned: every input that fails before the route's jar
{
	const app = make(() =>
		new Elysia()
			.onError(readSid)
			.onTransform(({ query }) => {
				if (query.boom) throw new Error('transform')
			})
			.get('/query', { query: t.Object({ n: t.Number() }) }, () => 'ok')
			.post('/body', { body: t.Object({ a: t.Number() }) }, () => 'ok')
			.get(
				'/headers',
				{ headers: t.Object({ 'x-n': t.Number() }) },
				() => 'ok'
			)
			.get(
				'/params/:n',
				{ params: t.Object({ n: t.Number() }) },
				() => 'ok'
			)
			.get('/transform', () => 'ok')
	)

	const requests: [string, Request, number][] = [
		['query', request('/query?n=x', 'sid=abc'), 422],
		[
			'body',
			request('/body', 'sid=abc', {
				method: 'POST',
				body: '{"a":"x"}',
				headers: { 'content-type': 'application/json' }
			}),
			422
		],
		[
			'body parse',
			request('/body', 'sid=abc', {
				method: 'POST',
				body: '{',
				headers: { 'content-type': 'application/json' }
			}),
			400
		],
		['headers', request('/headers', 'sid=abc'), 422],
		['params', request('/params/x', 'sid=abc'), 422],
		['transform', request('/transform?boom=1', 'sid=abc'), 500]
	]

	for (const [name, req, status] of requests) {
		const res = await app.handle(req)
		check(res.status, status, `unsigned ${name}: status`)
		check(await res.text(), '{"sid":"abc"}', `unsigned ${name}: body`)
	}
}

// a route-local error hook on a cookie-schema failure sees the raw cookie
{
	let seen: unknown
	const app = make(() =>
		new Elysia().get(
			'/',
			{
				cookie: t.Cookie({ n: t.Number() }),
				error({ cookie }) {
					seen = cookie.n.value
				}
			},
			({ cookie }) => cookie.n.value
		)
	)

	const res = await app.handle(request('/', 'n=abc'))
	check(res.status, 422, 'cookie schema: status')
	check(seen, 'abc', 'cookie schema: raw value')
}

// signed: the hook reads a verified value, writes are signed, a forged
// cookie never reaches it, and the validation error still wins
{
	const config = { cookie: { secrets: 's', sign: ['sid', 'flash'] } }
	let seen: unknown[] = []
	const app = make(() =>
		new Elysia(config)
			.onError(({ cookie, error }: any) => {
				seen.push(error.type)
				const sid = cookie.sid.value
				seen.push(sid)
				cookie.flash.value = 'retry'

				return { sid: sid ?? null }
			})
			.get(
				'/',
				{ query: t.Object({ n: t.Number() }) },
				({ cookie }) => cookie.sid.value
			)
	)

	const good = encodeURIComponent(await signCookie('user-42', 's', 'sid'))
	let res = await app.handle(request('/?n=x', `sid=${good}`))
	check(res.status, 422, 'signed: status')
	check(await res.text(), '{"sid":"user-42"}', 'signed: verified value')
	check(seen.join(), 'query,user-42', 'signed: hook saw')
	const pair = res.headers.get('set-cookie')?.split(';')[0] ?? ''
	check(
		await unsignCookie(
			decodeURIComponent(pair.slice('flash='.length)),
			's',
			'flash'
		),
		'retry',
		'signed: hook write is signed'
	)

	seen = []
	res = await app.handle(request('/?n=x', 'sid=admin'))
	check(seen.includes('admin'), false, 'forged: never read')
	check(seen[0], 'query', 'forged: query error first')
	check(res.status, 400, 'forged: rejected')
}

// a lane that awaits the jar must not run an error hook for a request aborted
// meanwhile: its side effects would run for a response nobody reads
{
	const seen: boolean[] = []
	const app = make(() =>
		new Elysia({ cookie: { secrets: 's', sign: ['sid'] } })
			.onError(({ cookie, request }) => {
				seen.push(request.signal.aborted)
				void cookie.sid.value

				return 'hook'
			})
			.get('/', { query: t.Object({ n: t.Number() }) }, () => 'ok')
	)

	const sid = encodeURIComponent(await signCookie('user', 's', 'sid'))
	const controller = new AbortController()
	const pending = app.handle(
		new Request('http://localhost/?n=x', {
			headers: { cookie: `sid=${sid}` },
			signal: controller.signal
		})
	)
	controller.abort()
	await pending
	check(seen.includes(true), false, 'abort: no hook after the abort')
}

if (failures.length) {
	console.error(failures.join('\n'))
	process.exit(1)
}

console.log(`${cases} ${lane} error jar cases passed`)
