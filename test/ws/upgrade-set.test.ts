import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { unsignCookie } from '../../src/cookie/crypto'

/**
 * what upgrade hooks write to `set` must reach the client on the 101,
 * as on an HTTP answer
 */

const SECRET = 'secret'
const signing = { secrets: SECRET, sign: ['session'] }

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

// Bun refuses to upgrade this one: the route and its hooks still run
const refused = (app: any, path: string) =>
	fetch(`http://${app.server.hostname}:${app.server.port}${path}`, {
		headers: { upgrade: 'websocket' },
		keepalive: false
	})

// every `name=value` pair: a second signing pass appends a second `session`
const pairsOf = (res: Response, name: string) =>
	res.headers
		.getSetCookie()
		.filter((c) => c.startsWith(`${name}=`))
		.map((c) => c.split(';')[0]!)

const verified = (pair: string) =>
	unsignCookie(
		decodeURIComponent(pair.slice('session='.length)),
		SECRET,
		'session'
	)

const signedApp = () =>
	new Elysia({ cookie: { secrets: SECRET, sign: ['session'] } }).use(
		websocket()
	)

describe('upgrade carries set', () => {
	it('defaults + header write does not 500', async () => {
		const app = new Elysia()
			.use(websocket())
			.headers({ 'x-default': 'd' })
			.ws('/ws', {
				beforeHandle({ set }: any) {
					set.headers['x-bh'] = '1'
				},
				message() {}
			})
			.listen(0)
		try {
			const res = await upgrade(app, '/ws')
			expect(res.status).toBe(101)
			expect(res.headers.get('x-bh')).toBe('1')
			expect(res.headers.get('x-default')).toBe('d')
		} finally {
			await app.stop(true)
		}
	})

	it('defaults + upgrade function write', async () => {
		const app = new Elysia()
			.use(websocket())
			.headers({ 'x-default': 'd' })
			.ws('/ws', {
				upgrade: (c: any) => {
					c.set.headers['x-fn'] = '1'
				},
				message() {}
			})
			.listen(0)
		try {
			const res = await upgrade(app, '/ws')
			expect(res.status).toBe(101)
			expect(res.headers.get('x-fn')).toBe('1')
		} finally {
			await app.stop(true)
		}
	})

	it('header write without defaults', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				beforeHandle({ set }: any) {
					set.headers['x-bh'] = '1'
				},
				message() {}
			})
			.listen(0)
		try {
			const res = await upgrade(app, '/ws')
			expect(res.status).toBe(101)
			expect(res.headers.get('x-bh')).toBe('1')
		} finally {
			await app.stop(true)
		}
	})

	it('upgrade object wins over set.headers', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				beforeHandle({ set }: any) {
					set.headers['x-bh'] = '1'
					set.headers['x-keep'] = 'k'
				},
				upgrade: { 'x-bh': '2', 'x-up': '1' },
				message() {}
			})
			.listen(0)
		try {
			const res = await upgrade(app, '/ws')
			expect(res.status).toBe(101)
			expect(res.headers.get('x-bh')).toBe('2')
			expect(res.headers.get('x-up')).toBe('1')
			expect(res.headers.get('x-keep')).toBe('k')
		} finally {
			await app.stop(true)
		}
	})

	it('signed cookie on the 101', async () => {
		const app = signedApp()
			.ws('/ws', {
				cookie: t.Cookie({ session: t.Optional(t.String()) }),
				beforeHandle({ cookie }: any) {
					cookie.session.value = 'user-42'
				},
				message() {}
			})
			.listen(0)
		try {
			const res = await upgrade(app, '/ws')
			expect(res.status).toBe(101)
			const pairs = pairsOf(res, 'session')
			expect(pairs).toHaveLength(1)
			expect(await verified(pairs[0]!)).toBe('user-42')

			const again = await upgrade(app, '/ws', pairs[0])
			expect(again.status).toBe(101)
		} finally {
			await app.stop(true)
		}
	})

	it('two cookies arrive as two headers', async () => {
		const app = signedApp()
			.ws('/ws', {
				cookie: t.Cookie({
					session: t.Optional(t.String()),
					theme: t.Optional(t.String())
				}),
				beforeHandle({ cookie }: any) {
					cookie.session.value = 'user-42'
					cookie.theme.value = 'dark'
				},
				message() {}
			})
			.listen(0)
		try {
			const res = await upgrade(app, '/ws')
			expect(res.status).toBe(101)
			const cookies = res.headers.getSetCookie()
			expect(cookies).toHaveLength(2)
			expect(cookies.filter((c) => c.startsWith('session='))).toHaveLength(1)
			expect(cookies.filter((c) => c.startsWith('theme='))).toHaveLength(1)
		} finally {
			await app.stop(true)
		}
	})

	it('nothing written, nothing added', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', { message() {} })
			.listen(0)
		try {
			const res = await upgrade(app, '/ws')
			expect(res.status).toBe(101)
			expect(res.headers.getSetCookie()).toEqual([])
			expect(res.headers.get('x-bh')).toBeNull()
		} finally {
			await app.stop(true)
		}
	})

	it('refused upgrade does not duplicate cookies', async () => {
		const app = signedApp()
			.ws('/ws', {
				cookie: t.Cookie({ session: t.Optional(t.String()) }),
				beforeHandle({ cookie }: any) {
					cookie.session.value = 'user-42'
				},
				message() {}
			})
			.listen(0)
		try {
			const res = await refused(app, '/ws')
			expect(res.status).toBe(400)
			const pairs = pairsOf(res, 'session')
			expect(pairs).toHaveLength(1)
			expect(await verified(pairs[0]!)).toBe('user-42')
		} finally {
			await app.stop(true)
		}
	})

	it('refused upgrade does not leak the upgrade headers', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', { upgrade: { 'x-up': '1' }, message() {} })
			.listen(0)
		try {
			const res = await refused(app, '/ws')
			expect(res.status).toBe(400)
			expect(res.headers.get('x-up')).toBeNull()
		} finally {
			await app.stop(true)
		}
	})
})
