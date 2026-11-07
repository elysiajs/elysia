// Per-request records (query, body, cookie jar, set.headers, optional-object
// bypass) are `new EmptyObject()`, so they all share ONE prototype. Request
// data may only ever land as own keys on a record whose prototype is that
// frozen, key-less, null-rooted object: if anything could write to it, one
// request would leak into every later request.
//
// Covered elsewhere, not repeated here:
// - JSON body `__proto__` / `constructor` / `prototype` stay own data:
//   test/validator/prototype-pollution.test.ts
// - multipart dotted paths (`__proto__.isAdmin`, `user.constructor`):
//   test/validator/body.test.ts "prevent prototype pollution ..."
// - cookie parser drops `__proto__` / `constructor` / `prototype`:
//   test/cookie/parser.test.ts, test/cookie/pollution.test.ts,
//   test/validator/cookie.test.ts "handle prototype pollution"
// - urlencoded/multipart body carry no constructor:
//   test/regression/security.test.ts "builds urlencoded and multipart bodies
//   off Object.prototype"
// - extension() copies a JSON-owned `__proto__` as a member:
//   test/lifecycle/http-error-extension.test.ts "copies members as data"

import { afterEach, describe, expect, it } from 'bun:test'

import { Elysia, HTTPError, t } from '../../src'
import { Cookie } from '../../src/cookie/cookie'
import { websocket } from '../../src/plugin/websocket'
import { EmptyObject } from '../../src/utils'
import { wsClosed, wsMessage, wsOpen } from '../ws/utils'

const objectPrototypeKeys = Reflect.ownKeys(Object.prototype)

const hostileKeys = [
	'__proto__',
	'constructor',
	'prototype',
	'__proto__[x]',
	'constructor[prototype][x]',
	'toString'
]
const hostileQuery = hostileKeys.map((key, i) => `${key}=${i}`).join('&')
const hostileEntries = hostileKeys.map((key, i): [string, unknown] => [
	key,
	String(i)
])

const hostileCookie =
	'__proto__=p; constructor=c; prototype=r; toString=t; ok=yes'

// names a leaked prototype would answer for
const probes = ['x', '__proto__', 'constructor', 'prototype', 'toString']

function expectSealedRecord(record: object) {
	const proto = Object.getPrototypeOf(record)

	expect(proto).toBe(EmptyObject.prototype)
	expect(Reflect.ownKeys(proto)).toEqual([])
	expect(Object.isFrozen(proto)).toBe(true)
	expect(Object.getPrototypeOf(proto)).toBeNull()
}

function expectNoGlobalPollution() {
	expect(({} as any).x).toBeUndefined()
	expect(Reflect.ownKeys(Object.prototype)).toEqual(objectPrototypeKeys)
	expect(Object.keys(Object.prototype)).toEqual([])
}

// nothing but own keys may be reachable from a per-request record
function expectNothingInherited(record: object) {
	const inherited: string[] = []
	for (const key in record)
		if (!Object.hasOwn(record, key)) inherited.push(key)

	expect(inherited).toEqual([])
	for (const name of probes)
		if (!Object.hasOwn(record, name)) expect(name in record).toBe(false)
}

const urlencoded = (url: string, body: string, cookie?: string) =>
	new Request(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			...(cookie ? { cookie } : {})
		},
		body
	})

describe('hostile keys on each EmptyObject entry point', () => {
	// the schema-less query is the raw parser output, keys are never split
	it('keeps hostile query keys as own data (no schema)', async () => {
		let query: any
		const app = new Elysia().get('/', (context) => {
			query = context.query
			return 'ok'
		})

		await app.handle(new Request(`http://localhost/?${hostileQuery}`))

		expect(Object.entries(query)).toEqual(hostileEntries)
		expectSealedRecord(query)
		expectNothingInherited(query)
		expectNoGlobalPollution()
	})

	// a schema strips what it does not declare; a declared dangerous name is
	// still plain data
	it('strips or keeps hostile query keys as own data (with schema)', async () => {
		let query: any
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					a: t.Optional(t.String()),
					constructor: t.Optional(t.String())
				})
			},
			(context) => {
				query = context.query
				return 'ok'
			}
		)

		const response = await app.handle(
			new Request(`http://localhost/?a=ok&${hostileQuery}`)
		)

		expect(response.status).toBe(200)
		expect(Object.entries(query)).toEqual([
			['a', 'ok'],
			['constructor', '1']
		])
		expect(Object.hasOwn(query, '__proto__')).toBe(false)
		expect(query.x).toBeUndefined()
		expectNoGlobalPollution()
	})

	it('keeps hostile urlencoded keys as own data', async () => {
		let body: any
		const app = new Elysia().post('/', (context) => {
			body = context.body
			return 'ok'
		})

		await app.handle(urlencoded('http://localhost/', hostileQuery))

		expect(Object.entries(body)).toEqual(hostileEntries)
		expectSealedRecord(body)
		expectNothingInherited(body)
		expectNoGlobalPollution()
	})

	// flat names are own data; a nested path through a dangerous segment is
	// dropped whole, including under a JSON-parsed parent, which (unlike the
	// EmptyObject records) does have Object.prototype on its chain
	it('drops multipart paths through a dangerous segment', async () => {
		let body: any
		const app = new Elysia().post('/', (context) => {
			body = context.body
			return 'ok'
		})

		const form = new FormData()
		form.append('__proto__', 'p')
		form.append('constructor', 'c')
		form.append('toString', 't')
		form.append('a[ok]', '1')
		form.append('j', '{"k":1}')
		for (const path of [
			'__proto__[x]',
			'constructor[prototype][x]',
			'a[__proto__][x]',
			'a[constructor][prototype][x]',
			'j[__proto__][x]',
			'j[constructor][prototype][x]'
		])
			form.append(path, 'v')

		const response = await app.handle(
			new Request('http://localhost/', { method: 'POST', body: form })
		)

		expect(response.status).toBe(200)
		expect(Object.keys(body)).toEqual([
			'__proto__',
			'constructor',
			'toString',
			'a',
			'j'
		])
		expect(body.__proto__).toBe('p')
		expect(body.constructor).toBe('c')
		expect(body.toString).toBe('t')
		expect(Object.entries(body.a)).toEqual([['ok', '1']])
		expect(Object.entries(body.j)).toEqual([['k', 1]])
		expectSealedRecord(body)
		expectSealedRecord(body.a)
		expectNothingInherited(body)
		expectNothingInherited(body.a)
		expectNoGlobalPollution()
	})

	// the parser drops `__proto__` / `constructor` / `prototype`; a jar read
	// of any name must hand back a Cookie, never something off a prototype
	for (const signed of [false, true])
		it(`reads hostile cookie names as data (${signed ? 'signed' : 'unsigned'})`, async () => {
			let cookie: any
			const app = new Elysia({
				cookie: signed ? { secrets: 's', sign: ['sid'] } : {}
			})
				.get('/sign', ({ cookie }) => {
					cookie.sid.value = 'S'
					return 'ok'
				})
				.get('/', (context) => {
					cookie = context.cookie
					return 'ok'
				})

			const sid = (
				await app.handle(new Request('http://localhost/sign'))
			).headers
				.getSetCookie()[0]
				.split(';')[0]

			await app.handle(
				new Request('http://localhost/', {
					headers: { cookie: `${hostileCookie}; ${sid}` }
				})
			)

			expect(Reflect.ownKeys(cookie)).toEqual(['toString', 'ok', 'sid'])
			expect(cookie.toString.value).toBe('t')
			expect(cookie.sid.value).toBe('S')
			for (const name of ['__proto__', 'constructor', 'prototype']) {
				expect(cookie[name]).toBeInstanceOf(Cookie)
				expect(cookie[name].value).toBeUndefined()
			}
			expect(cookie.toString).toBeInstanceOf(Cookie)
			expectSealedRecord(cookie)
			expectNoGlobalPollution()
		})

	// a handler writing a dangerous cookie name gets an own entry on the
	// response jar, not a write through the shared prototype
	it('writes hostile cookie names as own entries', async () => {
		let jar: any
		const app = new Elysia().get('/', ({ cookie, set }) => {
			;(cookie as any).__proto__.value = 'w'
			;(cookie as any).constructor.value = 'w'
			jar = set.cookie
			return 'ok'
		})

		await app.handle(new Request('http://localhost/'))

		expect(Reflect.ownKeys(jar)).toEqual(['__proto__', 'constructor'])
		expect(jar.__proto__.value).toBe('w')
		expect(jar.constructor.value).toBe('w')
		expectSealedRecord(jar)
		expectSealedRecord(jar.__proto__)
		expectNoGlobalPollution()
	})

	// fresh, or copied from `.headers()` defaults: an assigned `__proto__`
	// is an own header, never a prototype swap
	for (const defaults of [undefined, { 'x-default': '1' }])
		it(`keeps hostile set.headers keys as own data (${defaults ? 'with' : 'no'} defaults)`, async () => {
			let headers: any
			const base = defaults
				? new Elysia().headers(defaults)
				: new Elysia()
			const app = base.get('/', ({ set }) => {
				;(set.headers as any).__proto__ = 'p'
				;(set.headers as any).constructor = 'c'
				headers = set.headers
				return 'ok'
			})

			const response = await app.handle(new Request('http://localhost/'))

			expect(Object.entries(headers)).toEqual([
				...Object.entries(defaults ?? {}),
				['__proto__', 'p'],
				['constructor', 'c']
			])
			expect(response.headers.get('__proto__')).toBe('p')
			expect(response.headers.get('constructor')).toBe('c')
			expectSealedRecord(headers)
			expectNoGlobalPollution()
		})

	// an absent optional object is replaced by an empty record, not `{}`
	it('hands an absent optional object over as an empty sealed record', async () => {
		const seen: any[] = []
		const optional = t.Optional(t.Object({ a: t.Optional(t.String()) }))
		const app = new Elysia()
			.get('/', { query: optional }, ({ query }) => {
				seen.push(query)
				return 'ok'
			})
			.post('/', { body: optional }, ({ body }) => {
				seen.push(body)
				return 'ok'
			})

		await app.handle(new Request('http://localhost/'))
		await app.handle(new Request('http://localhost/', { method: 'POST' }))

		expect(seen).toHaveLength(2)
		for (const record of seen) {
			expect(Reflect.ownKeys(record)).toEqual([])
			expectSealedRecord(record)
			expectNothingInherited(record)
		}
	})

	// extension() accepts a parsed query as a plain object: its hostile keys
	// are copied out as members, the record it came from stays sealed
	it('serves a hostile parsed query handed to extension() as members', async () => {
		let query: any
		class Echo extends HTTPError.id('ECHO', 409) {
			constructor(readonly echoed: Record<string, unknown>) {
				super()
			}

			extension() {
				return this.echoed
			}
		}

		const app = new Elysia().get('/', (context) => {
			query = context.query
			throw new Echo(context.query)
		})

		const response = await app.handle(
			new Request('http://localhost/?__proto__=p&constructor=c')
		)
		const body = JSON.parse(await response.text())

		expect(response.status).toBe(409)
		expect(Object.hasOwn(body, '__proto__')).toBe(true)
		expect(body.__proto__).toBe('p')
		expect(body.constructor).toBe('c')
		expectSealedRecord(query)
		expectNoGlobalPollution()
	})

	describe('WebSocket', () => {
		let stop: (() => void) | undefined
		afterEach(() => {
			stop?.()
			stop = undefined
		})

		it('keeps hostile upgrade query keys as own data', async () => {
			let query: any
			const app = new Elysia()
				.use(websocket())
				.ws('/ws', {
					open(ws: any) {
						query = ws.query
						ws.send('ok')
					},
					message() {}
				})
				.listen(0)
			stop = () => app.stop()

			const ws = new WebSocket(
				`ws://${app.server!.hostname}:${app.server!.port}/ws?${hostileQuery}`
			)
			await wsOpen(ws)
			await wsMessage(ws)
			await wsClosed(ws)

			expect(Object.entries(query)).toEqual(hostileEntries)
			expectSealedRecord(query)
			expectNothingInherited(query)
			expectNoGlobalPollution()
		})
	})
})

describe('the shared prototype is not a cross-request channel', () => {
	// request 1 throws hostile keys at every entry point, request 2 sends
	// nothing: request 2 must see empty records with nothing inherited
	it('isolates a clean request from a hostile one', async () => {
		const seen: Record<string, object>[] = []
		const app = new Elysia().post(
			'/',
			({ request, query, body, cookie, set }) => {
				if (request.headers.has('cookie')) {
					;(cookie as any).__proto__.value = 'w'
					;(set.headers as any).__proto__ = 'p'
					;(set.headers as any).constructor = 'c'
				}

				seen.push({
					query,
					body: body as object,
					cookie,
					headers: set.headers
				})
				return 'ok'
			}
		)

		const form = new FormData()
		for (const key of hostileKeys) form.append(key, 'v')
		form.append('a[__proto__][x]', 'v')
		form.append('a[constructor][prototype][x]', 'v')

		await app.handle(
			urlencoded(
				`http://localhost/?${hostileQuery}`,
				hostileQuery,
				hostileCookie
			)
		)
		await app.handle(
			new Request(`http://localhost/?${hostileQuery}`, {
				method: 'POST',
				headers: { cookie: hostileCookie },
				body: form
			})
		)
		await app.handle(urlencoded('http://localhost/', ''))

		expect(seen).toHaveLength(3)
		const clean = seen[2]
		for (const [name, record] of Object.entries(clean)) {
			expect([name, Reflect.ownKeys(record)]).toEqual([name, []])
			expectSealedRecord(record)
			expectNothingInherited(record)
		}
		expectNoGlobalPollution()
	})

	// user-code misuse, not a parser path: a handler writing through the
	// shared prototype must fail instead of reaching the next request
	it('rejects a handler writing to the shared prototype', async () => {
		const seen: { threw: boolean; set: boolean; x: unknown }[] = []
		const app = new Elysia().get('/', ({ query }) => {
			const proto = Object.getPrototypeOf(query)
			let threw = false
			try {
				proto.x = 1
			} catch {
				threw = true
			}

			seen.push({
				threw,
				set: Reflect.set(proto, 'y', 1),
				x: (query as any).x
			})
			return 'ok'
		})

		await app.handle(new Request('http://localhost/'))
		await app.handle(new Request('http://localhost/'))

		expect(seen).toEqual([
			{ threw: true, set: false, x: undefined },
			{ threw: true, set: false, x: undefined }
		])
		expect(Reflect.ownKeys(EmptyObject.prototype)).toEqual([])
		expectNoGlobalPollution()
	})
})
