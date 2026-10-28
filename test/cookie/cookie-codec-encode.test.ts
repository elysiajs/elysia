import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'

// A cookie is read through its schema's Decode, so it must be written through
// its Encode: setting `cookie.d.value = new Date(0)` used to send the JSON
// string `"1970-…"` (quotes included), which t.Date rejects on the next
// request, and a custom codec's decoded value was sent as-is

const Len = t
	.Codec(t.String())
	.Decode((value) => value.length)
	.Encode((value) => 'x'.repeat(value))

const roundTrip = async (app: Elysia<any, any, any, any, any, any, any>) => {
	const set = await app.handle(new Request('http://localhost/set'))
	const sent = set.headers
		.getSetCookie()
		.map((cookie) => cookie.split(';')[0]!)

	const read = await app.handle(
		new Request('http://localhost/read', {
			headers: { cookie: sent.join('; ') }
		})
	)

	return { sent, read, text: await read.text() }
}

describe('cookie value encode', () => {
	it('sends a codec field encoded and reads it back decoded', async () => {
		const schema = t.Cookie({ d: t.Optional(t.Date()), l: t.Optional(Len) })
		const app = new Elysia()
			.get('/set', { cookie: schema }, ({ cookie }) => {
				cookie.d.value = new Date(0)
				cookie.l.value = 3
				return 'ok'
			})
			.get(
				'/read',
				{ cookie: schema },
				({ cookie }) =>
					`${cookie.d.value?.toISOString()} ${cookie.l.value}`
			)

		const { sent, read, text } = await roundTrip(app)
		expect(sent).toEqual(['d=1970-01-01T00%3A00%3A00.000Z', 'l=xxx'])
		expect(text).toBe('1970-01-01T00:00:00.000Z 3')
		// reading a cookie doesn't send it again
		expect(read.headers.getSetCookie()).toEqual([])
	})

	it('signs the encoded value', async () => {
		const schema = t.Cookie(
			{ d: t.Optional(t.Date()), l: t.Optional(Len) },
			{ secrets: 'secret', sign: ['d', 'l'] }
		)
		const app = new Elysia()
			.get('/set', { cookie: schema }, ({ cookie }) => {
				cookie.d.value = new Date(0)
				cookie.l.value = 3
				return 'ok'
			})
			.get(
				'/read',
				{ cookie: schema },
				({ cookie }) =>
					`${cookie.d.value?.toISOString()} ${cookie.l.value}`
			)

		const { sent, read, text } = await roundTrip(app)
		expect(sent[0]).toStartWith('d=1970-01-01T00%3A00%3A00.000Z.')
		expect(sent[1]).toStartWith('l=xxx.')
		expect(read.status).toBe(200)
		expect(text).toBe('1970-01-01T00:00:00.000Z 3')
	})

	it('leaves a field without a codec as before', async () => {
		const schema = t.Cookie({
			n: t.Optional(t.Number()),
			o: t.Optional(t.Object({ a: t.Number() }))
		})
		const app = new Elysia().get(
			'/set',
			{ cookie: schema },
			({ cookie }) => {
				cookie.n.value = 1
				cookie.o.value = { a: 1 }
				return 'ok'
			}
		)

		const response = await app.handle(new Request('http://localhost/set'))
		expect(
			response.headers
				.getSetCookie()
				.map((cookie) => cookie.split(';')[0])
		).toEqual(['n=1', 'o=%7B%22a%22%3A1%7D'])
	})
})

describe('cookie value encode, edges', () => {
	const send = async (app: any, path: string, cookie?: string) => {
		const response = await app.handle(
			new Request('http://localhost' + path, {
				headers: cookie ? { cookie } : {}
			})
		)

		return response.headers
			.getSetCookie()
			.map((value: string) => value.split(';')[0]!)
	}

	it('looks through t.Optional(t.Nullable(...)) to the codec', async () => {
		const schema = t.Cookie({ d: t.Optional(t.Nullable(t.Date())) })
		const app = new Elysia().get(
			'/set',
			{ cookie: schema },
			({ cookie }) => {
				cookie.d.value = new Date(0)
				return 'ok'
			}
		)

		expect(await send(app, '/set')).toEqual([
			'd=1970-01-01T00%3A00%3A00.000Z'
		])
	})

	it('keeps the encoder through equivalent $ref targets', async () => {
		const { compileCookieConfig } = await import('../../src/cookie/config')
		const shared = { ...t.Date(), $id: 'Shared' }
		const config = compileCookieConfig(
			t.Object({ d: t.Ref('Shared') }) as any,
			undefined,
			{ Shared: t.Date(), B: shared }
		)

		expect(typeof config.encode?.d).toBe('function')
	})

	it('encodes a frozen replacement entry', async () => {
		const schema = t.Cookie({ d: t.Optional(t.Date()) })
		const app = new Elysia().get(
			'/set',
			{ cookie: schema },
			({ cookie }) => {
				;(cookie.d as any).cookie = Object.freeze({
					value: new Date(0)
				})
				return 'ok'
			}
		)

		expect(await send(app, '/set')).toEqual([
			'd=1970-01-01T00%3A00%3A00.000Z'
		])
	})

	it("encodes a decoded '' but not a removal", async () => {
		const Blank = t
			.Codec(t.String())
			.Decode((value) => (value === 'x' ? '' : value))
			.Encode((value) => (value === '' ? 'x' : value))
		const schema = t.Cookie({ b: t.Optional(Blank) })
		const app = new Elysia()
			.get('/set', { cookie: schema }, ({ cookie }) => {
				cookie.b.value = ''
				return 'ok'
			})
			.get('/remove', { cookie: schema }, ({ cookie }) => {
				cookie.b.remove()
				return 'ok'
			})

		expect(await send(app, '/set')).toEqual(['b=x'])
		expect(await send(app, '/remove', 'b=y')).toEqual(['b='])
	})

	it('never encodes on a read-only request', async () => {
		let calls = 0
		const Wrapped = t
			.Codec(t.String())
			.Decode((value) => ({ value }))
			.Encode((value) => {
				calls++
				return value.value
			})
		const schema = t.Cookie({ w: t.Optional(Wrapped) })
		const app = new Elysia()
			.get(
				'/read',
				{ cookie: schema },
				({ cookie }) => cookie.w.value?.value
			)
			.get('/write', { cookie: schema }, ({ cookie }) => {
				cookie.w.value = { value: 'b' }
				return 'ok'
			})

		expect(await send(app, '/read', 'w=a')).toEqual([])
		expect(calls).toBe(0)

		expect(await send(app, '/write')).toEqual(['w=b'])
		expect(calls).toBe(1)
	})
})
