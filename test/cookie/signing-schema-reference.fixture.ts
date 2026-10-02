// schema-referenced signing config on the WebCrypto lane (no sync HMAC):
// the async parser must honour it, a field's `legacySignature: false` included
// own process: WebCrypto must be selected before the HMAC singleton loads
import assert from 'node:assert/strict'
;(Bun as any).CryptoHasher = undefined
;(process as any).getBuiltinModule = undefined

const { Elysia, t } = await import('../../src')
const { hasSyncHmac, signCookie } = await import('../../src/cookie/crypto')

assert.equal(hasSyncHmac, false)

const SECRET = 'Fischl von Luftschloss Narfidort'

const handler = ({ cookie }: any) => {
	const seen = String(cookie.session.value)
	cookie.session.value = 'u1'
	return seen
}

const object = () =>
	t.Cookie(
		{ session: t.Optional(t.String()) },
		{ secrets: SECRET, sign: ['session'] }
	)
const field = () =>
	t.Object({
		session: t.Cookie(t.Optional(t.String()), {
			secrets: SECRET,
			legacySignature: false
		})
	})

const apps: [name: string, app: any][] = [
	[
		'model name',
		new Elysia()
			.model({ Session: object() })
			.get('/', { cookie: 'Session' }, handler)
	],
	[
		'merge guard',
		new Elysia().guard({ schema: 'merge', cookie: object() }, (app) =>
			app.get('/', handler)
		)
	],
	[
		'macro',
		new Elysia()
			.macro({ auth: { cookie: object() } })
			.get('/', { auth: true } as any, handler)
	],
	[
		't.Intersect',
		new Elysia().get(
			'/',
			{ cookie: t.Intersect([object(), t.Object({})]) as any },
			handler
		)
	],
	[
		'per-field legacySignature: false model',
		new Elysia()
			.model({ Session: field() })
			.get('/', { cookie: 'Session' } as any, handler)
	]
]

const request = (cookie?: string) =>
	new Request('http://localhost/', cookie ? { headers: { cookie } } : {})
const signed = async (value: string, name?: string) =>
	encodeURIComponent(await signCookie(value, SECRET, name))

let passed = 0
for (const [name, app] of apps) {
	const issued = await app.handle(request())
	assert.equal(issued.status, 200, name)
	assert.ok(
		issued.headers
			.get('set-cookie')
			?.includes(`session=${await signed('u1', 'session')}`),
		`${name}: unsigned Set-Cookie`
	)

	const forged = await app.handle(request('session=admin'))
	assert.equal(forged.status, 400, `${name}: forged cookie accepted`)

	const genuine = await app.handle(
		request(`session=${await signed('admin', 'session')}`)
	)
	assert.equal(genuine.status, 200, name)
	assert.equal(await genuine.text(), 'admin', name)

	passed++
}

// a signature not bound to the cookie name, retired by the field
const legacy = await apps[4]![1].handle(
	request(`session=${await signed('admin')}`)
)
assert.equal(legacy.status, 400, 'field legacySignature: false ignored')
passed++

console.log(`${passed} WebCrypto cases passed`)
