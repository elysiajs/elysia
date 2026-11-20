// WebSocket upgrade exits on the async (WebCrypto) signer: the signature must
// land before `set` serializes, and a failed sign ends in the masked 500,
// which sends no cookie and logs once
// own process: WebCrypto must be selected before the HMAC singleton loads
import assert from 'node:assert/strict'

const log = console.error
console.error = () => {}
;(Bun as any).CryptoHasher = undefined
;(process as any).getBuiltinModule = undefined

const { Elysia, t } = await import('../../src')
const { websocket } = await import('../../src/plugin/websocket')
const { hasSyncHmac, unsignCookie } = await import('../../src/cookie/crypto')

assert.equal(hasSyncHmac, false)

let cases = 0
const failures: string[] = []
const check = (actual: unknown, expected: unknown, name: string) => {
	cases++
	if (actual !== expected)
		failures.push(`${name}: ${String(actual)} !== ${String(expected)}`)
}

// every `name=value` pair: a second signing pass appends a second `session`
const pairsOf = (res: Response, name: string) =>
	res.headers
		.getSetCookie()
		.filter((c) => c.startsWith(`${name}=`))
		.map((c) => c.split(';')[0]!)

const upgrade = (app: any) =>
	app.handle(
		new Request('http://localhost/p', {
			headers: {
				upgrade: 'websocket',
				connection: 'Upgrade',
				'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
				'sec-websocket-version': '13'
			}
		})
	) as Promise<Response>

const write = (cookie: any, value = 'user-42') => {
	cookie.session.value = value
	cookie.theme.value = 'dark'
}

const exits = (secrets: any) => {
	const make = (hooks: Record<string, unknown>) =>
		new Elysia({ cookie: { secrets, sign: ['session'] } })
			.use(websocket())
			.ws('/p', {
				cookie: t.Cookie({ session: t.Optional(t.String()) }),
				message() {},
				...hooks
			})

	return {
		'hook response': make({
			beforeHandle({ cookie }: any) {
				write(cookie)
				return 'denied'
			}
		}),
		'error hook': make({
			beforeHandle() {
				throw new Error('boom')
			},
			error({ cookie }: any) {
				write(cookie, 'from-error')
				return new Response('handled', { status: 200 })
			}
		}),
		'throwing error hook': make({
			beforeHandle({ cookie }: any) {
				write(cookie)
				throw new Error('boom')
			},
			async error() {
				await Promise.resolve()
				throw new Error('hook')
			}
		})
	}
}

// a throwing error hook ends in the masked 500, without the cookie
const expected = {
	'hook response': [200, 'user-42', 1],
	'error hook': [200, 'from-error', 1],
	'throwing error hook': [500, false, 0]
} as const

for (const [name, app] of Object.entries(exits('secret'))) {
	const res = await upgrade(app)
	const [status, value, count] = expected[name as keyof typeof expected]
	const pairs = pairsOf(res, 'session')
	const pair = pairs[0] ?? 'session='
	check(res.status, status, `${name}: status`)
	check(pairs.length, count, `${name}: session cookies`)
	check(
		await unsignCookie(
			decodeURIComponent(pair.slice('session='.length)),
			'secret',
			'session'
		),
		value,
		`${name}: signed`
	)
}

const failing = exits('secret')
crypto.subtle.sign = () => Promise.reject(new Error('signer down'))

for (const [name, app] of Object.entries(failing)) {
	const res = await upgrade(app)
	check(pairsOf(res, 'session').length, 0, `${name}: no unsigned session`)
	check(pairsOf(res, 'theme').join(), '', `${name}: no cookie`)

	// a failed sign is the masked 500
	const body = await res.text()
	check(res.status, 500, `${name}: status`)
	if (name === 'error hook')
		check(
			body.includes('handled'),
			false,
			`${name}: hook response replaced`
		)
	if (name === 'throwing error hook')
		check(body.includes('signer down'), false, `${name}: fallback kept`)
}

if (failures.length) {
	log(failures.join('\n'))
	process.exit(1)
}

console.log(`${cases} subtle signing cases passed`)
