// `verify: 'lazy'` (the default) must mean the same thing on every lane:
// an invalid signed cookie is rejected on its first read, not at request
// entry. The lanes that can't verify on access (WebCrypto, AOT) verify up
// front but must defer the rejection, or the same request is 200 on the Bun
// JIT and 400 in production
import assert from 'node:assert/strict'

const lane = process.argv[2] as 'subtle' | 'aot'
if (lane === 'subtle') {
	;(Bun as any).CryptoHasher = undefined
	;(process as any).getBuiltinModule = undefined
}

const { Elysia, t } = await import('../../src')
const { hasSyncHmac, signCookie } = await import('../../src/cookie/crypto')
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

const forged = 'session=forged.AAAA'
const get = (app: any, cookie: string) =>
	app.handle(new Request('http://localhost/', { headers: { cookie } }))

let cases = 0
// Collect instead of throwing on the first miss, so a regression names every
// access path it opened
const failures: string[] = []
const check = (actual: unknown, expected: unknown, name: string) => {
	cases++
	if (actual !== expected)
		failures.push(`${name}: ${String(actual)} !== ${String(expected)}`)
}

// an unread invalid cookie is harmless
{
	const app = make(() =>
		new Elysia({ cookie: { secrets: 's', sign: ['session'] } }).get(
			'/',
			({ cookie: { theme } }) => String(theme.value)
		)
	)
	const res = await get(app, `${forged}; theme=dark`)
	check(res.status, 200, 'unread forged cookie')
	check(await res.text(), 'dark', 'unread forged cookie body')
}

// a read rejects after derive ran, and derive's disposable is still released
{
	const log: string[] = []
	const app = make(() =>
		new Elysia({ cookie: { secrets: 's', sign: ['session'] } })
			.derive(() => {
				log.push('derive')
				return {
					res: {
						[Symbol.dispose]() {
							log.push('dispose')
						}
					}
				}
			})
			.get('/', ({ cookie: { session }, res }) => String(session.value))
	)
	const res = await get(app, forged)
	check(res.status, 400, 'read after derive')
	check(
		(await res.json().catch(() => undefined))?.type,
		'invalid-cookie',
		'read after derive type'
	)
	await Bun.sleep(10)
	check(log.join('>'), 'derive>dispose', 'derive ran and disposed')
}

// Lazy is a deliberate relaxation of the old eager rejection, so every way to
// reach the forged value must still reject: a caught rejection is not a pass
const reach: Record<string, (cookie: any) => unknown> = {
	value: (cookie) => cookie.session.value,
	'value twice': (cookie) => {
		try {
			cookie.session.value
		} catch {}
		return cookie.session.value
	},
	in: (cookie) => 'session' in cookie,
	spread: (cookie) => ({ ...cookie }),
	'Object.keys': (cookie) => Object.keys(cookie),
	'Object.entries': (cookie) => Object.entries(cookie),
	'Object.assign': (cookie) => Object.assign({}, cookie),
	'Reflect.ownKeys': (cookie) => Reflect.ownKeys(cookie),
	descriptor: (cookie) => Object.getOwnPropertyDescriptor(cookie, 'session'),
	'JSON.stringify': (cookie) => JSON.stringify(cookie),
	'write then read': (cookie) => {
		try {
			cookie.session.value = 'replacement'
		} catch {}
		return cookie.session.value
	}
}

for (const [name, read] of Object.entries(reach)) {
	const app = make(() =>
		new Elysia({ cookie: { secrets: 's', sign: ['session'] } }).get(
			'/',
			({ cookie }) => {
				try {
					read(cookie)
					return 'read'
				} catch {
					return 'rejected'
				}
			}
		)
	)
	check(await (await get(app, forged)).text(), 'rejected', name)
}

// a copy made in derive carries the rejection into the handler
for (const [name, derive] of [
	['spread', ({ cookie }: any) => ({ copied: { ...cookie } })],
	['entry', ({ cookie }: any) => ({ copied: cookie.session })]
] as const) {
	const app = make(() =>
		new Elysia({ cookie: { secrets: 's', sign: ['session'] } })
			.derive(derive as any)
			.get('/', ({ copied }: any) => String(copied.value))
	)
	check((await get(app, forged)).status, 400, `derive copy (${name})`)
}

// a server-side replacement shadows the forged value and goes out signed
{
	const app = make(() =>
		new Elysia({ cookie: { secrets: 's', sign: ['session'] } }).get(
			'/',
			({ cookie, set }) => {
				set.cookie = { session: { value: 'server' } } as any
				return String(cookie.session.value)
			}
		)
	)
	const res = await get(app, forged)
	check(await res.text(), 'server', 'server replacement')
	check(
		/^session=server\.[^;]+/.test(res.headers.get('set-cookie') ?? ''),
		true,
		'server replacement signed'
	)
}

// a cookie validator needs verified values, so it stays eager
{
	const app = make(() =>
		new Elysia({ cookie: { secrets: 's', sign: ['session'] } }).get(
			'/',
			{ cookie: t.Cookie({ theme: t.Optional(t.String()) }) },
			({ cookie: { theme } }) => String(theme.value)
		)
	)
	check(
		(await get(app, `${forged}; theme=dark`)).status,
		400,
		'cookie validator stays eager'
	)
}

// a valid cookie still reads its value
{
	const app = make(() =>
		new Elysia({ cookie: { secrets: 's', sign: ['session'] } }).get(
			'/',
			({ cookie: { session } }) => String(session.value)
		)
	)
	const res = await get(
		app,
		`session=${encodeURIComponent(await signCookie('user-42', 's'))}`
	)
	check(await res.text(), 'user-42', 'valid cookie')
}

// The invalid-signature marker is a `{ '~invalid': 1 }` in the raw record. A
// client controls the JSON of an UNSIGNED cookie, and of a signed one when the
// rotation accepts unsigned values (`null` secret), so that shape from a client
// is just a value, never a rejection, as on the Bun JIT
{
	const app = make(() =>
		new Elysia({ cookie: { secrets: 's', sign: ['session'] } }).get(
			'/',
			({ cookie: { prefs } }) => JSON.stringify(prefs.value)
		)
	)
	const res = await get(app, `prefs=${encodeURIComponent('{"~invalid":1}')}`)
	check(res.status, 200, 'unsigned marker-shaped JSON: status')
	check(await res.text(), '{"~invalid":1}', 'unsigned marker-shaped JSON')
}

{
	const app = make(() =>
		new Elysia({ cookie: { secrets: ['s', null], sign: ['session'] } }).get(
			'/',
			({ cookie: { session } }) => JSON.stringify(session.value)
		)
	)
	const res = await get(
		app,
		`session=${encodeURIComponent('{"~invalid":1}')}`
	)
	check(res.status, 200, 'null-secret marker-shaped JSON: status')
	check(await res.text(), '{"~invalid":1}', 'null-secret marker-shaped JSON')
}

// verify: 'eager' still rejects at entry
{
	const app = make(() =>
		new Elysia({
			cookie: { secrets: 's', sign: ['session'], verify: 'eager' }
		}).get('/', ({ cookie: { theme } }) => String(theme.value))
	)
	check(
		(await get(app, `${forged}; theme=dark`)).status,
		400,
		"verify: 'eager'"
	)
}

// the WebSocket upgrade lane is interpreted, not frozen: same contract
if (lane === 'subtle') {
	const { websocket } = await import('../../src/plugin/websocket')
	const app = new Elysia({ cookie: { secrets: 's', sign: ['session'] } })
		.use(websocket())
		.ws('/unread', {
			beforeHandle({ cookie: { theme } }) {
				if (theme.value !== 'dark')
					return new Response('no', { status: 403 })
			},
			message() {}
		})
		.ws('/read', {
			beforeHandle({ cookie: { session } }) {
				void session.value
			},
			message() {}
		})
		.listen(0)
	const upgrade = (path: string, cookie: string) =>
		fetch(`http://${app.server!.hostname}:${app.server!.port}${path}`, {
			headers: {
				cookie,
				upgrade: 'websocket',
				connection: 'Upgrade',
				'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
				'sec-websocket-version': '13'
			}
		})
	try {
		check(
			(await upgrade('/unread', `${forged}; theme=dark`)).status,
			101,
			'ws unread'
		)
		check((await upgrade('/read', forged)).status, 400, 'ws read')
	} finally {
		app.stop(true)
	}
}

if (failures.length) {
	console.error(failures.join('\n'))
	process.exit(1)
}

console.log(`${cases} lazy verification cases passed`)
