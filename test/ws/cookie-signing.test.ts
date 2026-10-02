import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { unsignCookie } from '../../src/cookie/crypto'

/**
 * a hook or error can answer a WebSocket upgrade with a plain HTTP response
 * carrying `set`: the route's signed cookies must leave signed (unsigned is
 * refused by the next upgrade, a `null` rotation secret would accept it)
 */

const SECRET = 'secret'
const signing = { secrets: SECRET, sign: ['session'] }
const session = () => t.Cookie({ session: t.Optional(t.String()) })

// the signing policy from app config, inline `t.Cookie` or a model must reach the signer
const forms = {
	app: () => ({
		app: new Elysia({ cookie: signing }),
		cookie: session() as any
	}),
	inline: () => ({
		app: new Elysia(),
		cookie: t.Cookie({ session: t.Optional(t.String()) }, signing) as any
	}),
	model: () => ({
		app: new Elysia().model({
			Session: t.Cookie({ session: t.Optional(t.String()) }, signing)
		}),
		cookie: 'Session' as any
	})
}

const upgradeHeaders = (cookie?: string) => ({
	upgrade: 'websocket',
	connection: 'Upgrade',
	'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
	'sec-websocket-version': '13',
	...(cookie ? { cookie } : {})
})

// no pooled connection: a kept-alive socket would answer for the next app on the port
const upgrade = (app: any, path: string, cookie?: string) =>
	fetch(`http://${app.server.hostname}:${app.server.port}${path}`, {
		headers: upgradeHeaders(cookie),
		keepalive: false
	})

// every `name=value` pair: a second signing pass appends a second `session`
const pairsOf = (res: Response, name: string) =>
	res.headers
		.getSetCookie()
		.filter((c) => c.startsWith(`${name}=`))
		.map((c) => c.split(';')[0]!)

// the value `session` carries, verified with the route's secret: false if unsigned
const verified = (pair: string) =>
	unsignCookie(
		decodeURIComponent(pair.slice('session='.length)),
		SECRET,
		'session'
	)

const write = (cookie: any, value = 'user-42') => {
	cookie.session.value = value
}

type Exit = [
	name: string,
	status: number,
	value: string,
	mount: (app: any, cookie: any) => any,
	requestCookie?: string
]

const exits: Exit[] = [
	[
		'a beforeHandle returns a value',
		200,
		'user-42',
		(app, cookie) =>
			app.ws('/p', {
				cookie,
				beforeHandle({ cookie }: any) {
					write(cookie)
					return 'denied'
				},
				message() {}
			})
	],
	[
		'a beforeHandle returns status()',
		401,
		'user-42',
		(app, cookie) =>
			app.ws('/p', {
				cookie,
				beforeHandle({ cookie, status }: any) {
					write(cookie)
					return status(401, 'no')
				},
				message() {}
			})
	],
	[
		'a derive returns status()',
		401,
		'user-42',
		(app, cookie) =>
			app
				.derive(({ cookie, status }: any) => {
					write(cookie)
					return status(401, 'no')
				})
				.ws('/p', { cookie, message() {} })
	],
	[
		'a transform throws',
		500,
		'user-42',
		(app, cookie) =>
			app.ws('/p', {
				cookie,
				transform({ cookie }: any) {
					write(cookie)
					throw new Error('boom')
				},
				message() {}
			})
	],
	[
		'a beforeHandle throws',
		500,
		'user-42',
		(app, cookie) =>
			app.ws('/p', {
				cookie,
				beforeHandle({ cookie }: any) {
					write(cookie)
					throw new Error('boom')
				},
				message() {}
			})
	],
	[
		'an error hook handles the error',
		500,
		'user-42',
		(app, cookie) =>
			app.ws('/p', {
				cookie,
				beforeHandle({ cookie }: any) {
					write(cookie)
					throw new Error('boom')
				},
				error: () => 'handled',
				message() {}
			})
	],
	[
		'an error hook writes the cookie',
		500,
		'from-error',
		(app, cookie) =>
			app.ws('/p', {
				cookie,
				beforeHandle() {
					throw new Error('boom')
				},
				error({ cookie }: any) {
					write(cookie, 'from-error')
					return 'handled'
				},
				message() {}
			})
	],
	[
		// falls through to the app-level fallback
		'an error hook throws',
		500,
		'user-42',
		(app, cookie) =>
			app.ws('/p', {
				cookie,
				beforeHandle({ cookie }: any) {
					write(cookie)
					throw new Error('boom')
				},
				async error() {
					await Promise.resolve()
					throw new Error('hook')
				},
				message() {}
			})
	],
	[
		'validation rejects the upgrade',
		422,
		'user-42',
		(app, cookie) =>
			app
				.request(({ set }: any) => {
					set.cookie = { session: { value: 'user-42' } }
				})
				.ws('/p', {
					cookie,
					query: t.Object({ q: t.String() }),
					message() {}
				})
	],
	[
		'a forged signed cookie is rejected',
		400,
		'from-error',
		(app, cookie) =>
			app.ws('/p', {
				cookie,
				error({ set }: any) {
					set.cookie = { session: { value: 'from-error' } }
				},
				message() {}
			}),
		'session=forged'
	],
	[
		'upgrade() throws',
		500,
		'user-42',
		(app, cookie) =>
			app.ws('/p', {
				cookie,
				upgrade({ cookie }: any) {
					write(cookie)
					throw new Error('boom')
				},
				message() {}
			})
	]
]

describe('WebSocket upgrade responses sign cookies', () => {
	for (const [form, make] of Object.entries(forms))
		for (const [name, status, value, mount, requestCookie] of exits)
			it(`${form} config: ${name}`, async () => {
				const { app: base, cookie } = make()
				// `/me` comes first so the exit's own hooks never reach it
				const app = mount(
					base.use(websocket()).ws('/me', { cookie, message() {} }),
					cookie
				).listen(0)

				try {
					const res = await upgrade(app, '/p', requestCookie)
					expect(res.status).toBe(status)

					const pairs = pairsOf(res, 'session')
					expect(pairs).toHaveLength(1)
					// exactly the written value (unsigned is `false`, a double signature is not the value)
					expect(await verified(pairs[0]!)).toBe(value)

					// and the route's own verifier accepts it on the next upgrade
					expect((await upgrade(app, '/me', pairs[0])).status).toBe(
						101
					)
				} finally {
					await app.stop(true)
				}
			})

	// the success lane signs, then serialization throws into the error lane which
	// signs `set` again: it must not double-sign
	it('signs once when mapping the response fails after signing', async () => {
		const app = new Elysia({ cookie: signing })
			.use(websocket())
			.ws('/p', {
				cookie: session(),
				beforeHandle({ cookie }: any) {
					write(cookie)
					// JSON.stringify throws on BigInt while mapping
					return { n: 1n }
				},
				message() {}
			})
			.listen(0)

		try {
			const res = await upgrade(app, '/p')
			expect(res.status).toBe(500)

			const pairs = pairsOf(res, 'session')
			expect(pairs).toHaveLength(1)
			expect(await verified(pairs[0]!)).toBe('user-42')
		} finally {
			await app.stop(true)
		}
	})
})

// `[null, secret]` verifies but has no current key to sign with: every signed
// cookie is dropped, never sent unsigned, the rest of the response survives
describe('WebSocket upgrade responses fail closed when signing fails', () => {
	const unsignable = () =>
		new Elysia({
			cookie: { secrets: [null, SECRET] as any, sign: ['session'] }
		}).use(websocket())

	const writeBoth = (cookie: any) => {
		write(cookie)
		cookie.theme.value = 'dark'
	}

	const expectDropped = (res: Response) => {
		expect(pairsOf(res, 'session')).toEqual([])
		expect(pairsOf(res, 'theme')).toEqual(['theme=dark'])
	}

	it('turns a failed sign on a hook response into the error', async () => {
		const app = unsignable()
			.ws('/p', {
				cookie: session(),
				beforeHandle({ cookie }: any) {
					writeBoth(cookie)
					return 'denied'
				},
				message() {}
			})
			.listen(0)

		try {
			const res = await upgrade(app, '/p')
			expect(res.status).toBe(500)
			expectDropped(res)
		} finally {
			await app.stop(true)
		}
	})

	// a cookie that failed to sign falls to the app-level fallback (500 like
	// HTTP), never the route error hook's 200 with the cookie silently missing
	it('replaces a route error hook response with the fallback', async () => {
		const app = unsignable()
			.ws('/p', {
				cookie: session(),
				beforeHandle() {
					throw new Error('boom')
				},
				error({ cookie }: any) {
					writeBoth(cookie)
					return new Response('handled', { status: 200 })
				},
				message() {}
			})
			.listen(0)

		try {
			const res = await upgrade(app, '/p')
			expect(res.status).toBe(500)
			expect(await res.text()).not.toBe('handled')
			expectDropped(res)
		} finally {
			await app.stop(true)
		}
	})

	it('drops on the app-level fallback after an error hook throws', async () => {
		const app = unsignable()
			.ws('/p', {
				cookie: session(),
				beforeHandle({ cookie }: any) {
					writeBoth(cookie)
					throw new Error('boom')
				},
				error() {
					throw new Error('hook')
				},
				message() {}
			})
			.listen(0)

		try {
			const res = await upgrade(app, '/p')
			expect(res.status).toBe(500)
			expectDropped(res)
		} finally {
			await app.stop(true)
		}
	})
})

// these exits don't serialize `set` today: one that starts forwarding it must sign
describe('WebSocket upgrade exits without `set`', () => {
	it('never emit an unsigned signed cookie', async () => {
		const hooks = {
			cookie: session(),
			beforeHandle({ cookie }: any) {
				write(cookie)
			},
			message() {}
		}

		const app = new Elysia({ cookie: signing })
			.use(websocket())
			.ws('/accepted', hooks)
			.ws('/response', {
				...hooks,
				beforeHandle({ cookie }: any) {
					write(cookie)
					return new Response('no', { status: 403 })
				}
			})
			.listen(0)

		const idle = new Elysia({ cookie: signing })
			.use(websocket())
			.ws('/p', hooks)

		try {
			const refused = await fetch(
				`http://${app.server!.hostname}:${app.server!.port}/accepted`,
				{
					headers: { upgrade: 'websocket', connection: 'Upgrade' },
					keepalive: false
				}
			)
			const responses = [
				await upgrade(app, '/accepted'),
				await upgrade(app, '/response'),
				refused,
				await idle.handle(
					new Request('http://localhost/p', {
						headers: upgradeHeaders()
					})
				)
			]

			expect(responses.map((r) => r.status)).toEqual([101, 403, 400, 500])

			for (const res of responses)
				for (const pair of pairsOf(res, 'session'))
					expect(await verified(pair)).toBe('user-42')
		} finally {
			await app.stop(true)
		}
	})
})

describe('WebSocket upgrade responses on the asynchronous signer', () => {
	it('sign before serializing and fail closed', async () => {
		const child = Bun.spawn(
			[process.execPath, import.meta.dir + '/cookie-signing.fixture.ts'],
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
			expect(stdout.trim()).toBe('20 subtle signing cases passed')
		} finally {
			clearTimeout(timeout)
		}
	})
})
