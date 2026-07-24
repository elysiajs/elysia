import { describe, it, expect } from 'bun:test'
import { Elysia, t, status } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { ElysiaError } from '../../src/error'
import { newWebsocket, wsOpen, wsClosed } from '../ws/utils'

const Coded = t
	.Codec(t.String())
	.Decode((s: string) => Number(s.replace(/^n:/, '')))
	.Encode((n: number) => `n:${n}`)

function wsProbe(
	server: any,
	path: string,
	send: string,
	expect = 1,
	timeout = 3000
): Promise<{
	opened: boolean
	frames: string[]
	close: { code: number } | null
}> {
	return new Promise((resolve) => {
		const ws = newWebsocket(server, path)
		const frames: string[] = []
		let opened = false
		let close: { code: number } | null = null
		let done = false

		const finish = () => {
			if (done) return
			done = true
			clearTimeout(timer)
			try {
				ws.close()
			} catch {}
			resolve({ opened, frames, close })
		}

		const timer = setTimeout(finish, timeout)

		ws.onopen = () => {
			opened = true
			ws.send(send)
		}
		ws.onmessage = (e) => {
			frames.push(String(e.data))
			if (frames.length >= expect) finish()
		}
		ws.onclose = (e) => {
			close = { code: e.code }
		}
		ws.onerror = () => {}
	})
}

describe('HTTP and WebSocket lifecycle', () => {
	it('WS per-message stage order matches HTTP per-route stage order', async () => {
		const httpOrder: string[] = []
		const httpApp = new Elysia().get(
			'/order',
			{
				transform() {
					httpOrder.push('transform')
				},
				beforeHandle() {
					httpOrder.push('beforeHandle')
				},
				afterHandle() {
					httpOrder.push('afterHandle')
				}
			},
			() => {
				httpOrder.push('handler')
				return 'ok'
			}
		)
		await httpApp.handle(new Request('http://localhost/order'))

		// Ignore upgrade-phase calls; compare message handling only.
		let inMessage = false
		const wsOrder: string[] = []
		const wsApp = new Elysia()
			.use(websocket()).ws('/order', {
				transform() {
					if (inMessage) wsOrder.push('transform')
				},
				beforeHandle() {
					if (inMessage) wsOrder.push('beforeHandle')
				},
				afterHandle() {
					wsOrder.push('afterHandle')
				},
				message(ws: any) {
					wsOrder.push('handler')
					ws.send('ok')
				}
			})
			.listen(0)

		const ws = newWebsocket(wsApp.server!, '/order')
		await wsOpen(ws)
		inMessage = true
		const got = new Promise<void>((resolve) => {
			ws.onmessage = () => resolve()
		})
		ws.send('x')
		await got
		await new Promise((r) => setTimeout(r, 20))

		await wsClosed(ws)
		wsApp.stop()

		expect(httpOrder).toEqual([
			'transform',
			'beforeHandle',
			'handler',
			'afterHandle'
		])
		expect(wsOrder).toEqual([
			'transform',
			'beforeHandle',
			'handler',
			'afterHandle'
		])
	})

	it('body validation failure is RFC 9457 problem+json on both transports', async () => {
		const httpApp = new Elysia().post(
			'/v',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => body.n
		)
		const httpRes = await httpApp.handle(
			new Request('http://localhost/v', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ n: 'nope' })
			})
		)
		expect(httpRes.status).toBe(422)
		const httpBody = JSON.parse(await httpRes.text())

		const wsApp = new Elysia()
			.use(websocket()).ws('/v', {
				body: t.Object({ n: t.Number() }),
				message(ws: any) {
					ws.send(String(ws.body.n))
				}
			})
			.listen(0)

		const { frames } = await wsProbe(
			wsApp.server!,
			'/v',
			JSON.stringify({ n: 'nope' })
		)
		wsApp.stop()

		expect(frames).toHaveLength(1)
		const wsBody = JSON.parse(frames[0])

		const shape = (b: any) => ({
			type: b.type,
			title: b.title,
			status: b.status,
			on: b.on,
			property: b.property
		})
		const expected = {
			type: 'validation',
			title: 'Validation Error',
			status: 422,
			on: 'body',
			property: '/n'
		}
		expect(shape(httpBody)).toEqual(expected)
		expect(shape(wsBody)).toEqual(expected)
	})

	it('valid body passes validation identically on both transports', async () => {
		const httpApp = new Elysia().post(
			'/v',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => String(body.n)
		)
		const httpRes = await httpApp.handle(
			new Request('http://localhost/v', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ n: 5 })
			})
		)
		expect(await httpRes.text()).toBe('5')

		const wsApp = new Elysia()
			.use(websocket()).ws('/v', {
				body: t.Object({ n: t.Number() }),
				message(ws: any) {
					ws.send(String(ws.body.n))
				}
			})
			.listen(0)
		const { frames } = await wsProbe(
			wsApp.server!,
			'/v',
			JSON.stringify({ n: 5 })
		)
		wsApp.stop()

		expect(frames).toEqual(['5'])
	})

	it('Date response bodies match even though only HTTP applies response encoding', async () => {
		const iso = '2020-01-01T00:00:00.000Z'

		const httpApp = new Elysia().get(
			'/date',
			{ response: t.Object({ when: t.Date() }) },
			() => ({ when: new Date(iso) })
		)
		const httpRes = await httpApp.handle(
			new Request('http://localhost/date')
		)
		const httpBody = await httpRes.text()

		const wsApp = new Elysia()
			.use(websocket()).ws('/date', {
				response: t.Object({ when: t.Date() }),
				message(ws: any) {
					ws.send({ when: new Date(iso) })
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/date', 'go')
		wsApp.stop()

		expect(httpBody).toBe(`{"when":"${iso}"}`)
		expect(frames).toEqual([`{"when":"${iso}"}`])
	})

	it('encodes response codecs on HTTP but validates raw values on WebSocket', async () => {
		const httpApp = new Elysia().get(
			'/c',
			{ response: t.Object({ v: Coded }) },
			() => ({ v: 42 })
		)
		const httpRes = await httpApp.handle(new Request('http://localhost/c'))
		expect(httpRes.status).toBe(200)
		expect(await httpRes.text()).toBe('{"v":"n:42"}')

		const wsApp = new Elysia()
			.use(websocket()).ws('/c', {
				response: t.Object({ v: Coded }),
				message(ws: any) {
					ws.send({ v: 42 })
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/c', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toBe('{"v":"n:42"}')
		expect(frames[0]).toContain('must be string')
	})

	it('uses afterHandle return values on HTTP but not WebSocket', async () => {
		const httpApp = new Elysia().get(
			'/after',
			{ afterHandle: () => 'AFTER-WINS' },
			() => 'handler-body'
		)
		const httpRes = await httpApp.handle(
			new Request('http://localhost/after')
		)
		expect(await httpRes.text()).toBe('AFTER-WINS')

		const wsApp = new Elysia()
			.use(websocket()).ws('/after', {
				afterHandle: () => 'AFTER-WINS' as any,
				message(ws: any) {
					ws.send('handler-body')
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/after', 'go')
		wsApp.stop()

		expect(frames).toEqual(['handler-body'])
	})

	it('preserves a thrown status code and value on HTTP and WebSocket', async () => {
		const httpApp = new Elysia().get('/st', () => {
			throw status(418, 'teapot')
		})
		const httpRes = await httpApp.handle(new Request('http://localhost/st'))
		expect(httpRes.status).toBe(418)
		expect(await httpRes.text()).toBe('teapot')

		const wsApp = new Elysia()
			.use(websocket()).ws('/st', {
				message() {
					throw status(418, 'teapot')
				}
			})
			.listen(0)
		const { frames: thrownFrames } = await wsProbe(
			wsApp.server!,
			'/st',
			'go'
		)

		const returnedApp = new Elysia()
			.use(websocket()).ws('/ret', {
				message() {
					return status(418, 'teapot')
				}
			})
			.listen(0)
		const { frames: returnedFrames } = await wsProbe(
			returnedApp.server!,
			'/ret',
			'go'
		)
		wsApp.stop()
		returnedApp.stop()

		expect(thrownFrames).toHaveLength(1)
		const wsBody = JSON.parse(thrownFrames[0])
		expect(wsBody).toEqual({ status: 418, error: 'teapot' })
		expect(thrownFrames).toEqual(returnedFrames)
	})

	it('serializes uncaught development errors identically on HTTP and WebSocket', async () => {
		const httpApp = new Elysia().get('/e', () => {
			throw new Error('kaboom')
		})
		const httpRes = await httpApp.handle(new Request('http://localhost/e'))
		expect(httpRes.status).toBe(500)
		expect(httpRes.headers.get('content-type')).toBe(
			'application/problem+json'
		)
		const httpText = await httpRes.text()
		expect(JSON.parse(httpText)).toMatchObject({
			status: 500,
			detail: 'kaboom'
		})

		const wsApp = new Elysia()
			.use(websocket()).ws('/e', {
				message() {
					throw new Error('kaboom')
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/e', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).toBe(httpText)
	})

	it('masks a thrown string identically on HTTP and WebSocket', async () => {
		const httpApp = new Elysia().get('/ts', () => {
			throw 'secret-string'
		})
		const httpRes = await httpApp.handle(new Request('http://localhost/ts'))
		expect(httpRes.status).toBe(500)
		const httpText = await httpRes.text()
		expect(httpText).not.toContain('secret-string')

		const wsApp = new Elysia()
			.use(websocket()).ws('/ts', {
				message() {
					throw 'secret-string'
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/ts', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toContain('secret-string')
		expect(frames[0]).toBe(httpText)
	})

	it('masks a thrown object identically on HTTP and WebSocket', async () => {
		const httpApp = new Elysia().get('/to', () => {
			throw { password: 'secret-object' }
		})
		const httpRes = await httpApp.handle(new Request('http://localhost/to'))
		expect(httpRes.status).toBe(500)
		const httpText = await httpRes.text()
		expect(httpText).not.toContain('secret-object')

		const wsApp = new Elysia()
			.use(websocket()).ws('/to', {
				message() {
					throw { password: 'secret-object' }
				}
			})
			.listen(0)
		const { frames } = await wsProbe(wsApp.server!, '/to', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toContain('secret-object')
		expect(frames[0]).not.toContain('[object Object]')
		expect(frames[0]).toBe(httpText)
	})

	it('sends an Error frame before a close queued in finally', async () => {
		const wsApp = new Elysia()
			.use(websocket()).ws('/race', {
				message(ws: any) {
					try {
						throw new Error('race')
					} finally {
						queueMicrotask(() => ws.close())
					}
				}
			})
			.listen(0)

		const { frames } = await wsProbe(wsApp.server!, '/race', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		const body = JSON.parse(frames[0])
		expect(body).toMatchObject({ status: 500, detail: 'race' })
	})

	it('sends an ElysiaError frame before a queued close and matches HTTP', async () => {
		class Teapot extends ElysiaError {
			status = 418 as any
			problemType = 'teapot'
			problemTitle = 'I am a teapot'
			constructor() {
				super('short and stout')
			}
		}

		const httpApp = new Elysia().get('/teapot', () => {
			throw new Teapot()
		})
		const httpRes = await httpApp.handle(
			new Request('http://localhost/teapot')
		)
		expect(httpRes.status).toBe(418)
		const httpText = await httpRes.text()

		const wsApp = new Elysia()
			.use(websocket()).ws('/teapot', {
				message(ws: any) {
					try {
						throw new Teapot()
					} finally {
						queueMicrotask(() => ws.close())
					}
				}
			})
			.listen(0)

		const { frames } = await wsProbe(wsApp.server!, '/teapot', 'go')
		wsApp.stop()

		expect(frames).toHaveLength(1)
		expect(frames[0]).toBe(httpText)
		expect(JSON.parse(frames[0])).toEqual({
			type: 'teapot',
			title: 'I am a teapot',
			status: 418
		})
	})
})
