import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

describe('WebSocket message body', () => {
	it('keeps ws.body available to later parameter defaults', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message: ((ws: any, _body: unknown, fromView = ws.body) =>
					ws.send(`default:${fromView}`)) as any
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		const message = wsMessage(ws)
		ws.send('payload')

		expect((await message).data).toBe('default:payload')

		await wsClosed(ws)
		app.stop()
	})

	it('retains the upgrade Request for later open parameter defaults', async () => {
		const app = new Elysia()
			.ws('/ws', {
				open: ((ws: any, request = ws.request) =>
					ws.send(
						request instanceof Request ? 'request' : 'missing'
					)) as any,
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		const message = wsMessage(ws)
		await wsOpen(ws)

		expect((await message).data).toBe('request')

		await wsClosed(ws)
		app.stop()
	})

	it('delivers the positional body when the handler does not read ws.body', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, message) {
					ws.send(`echo:${message}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('hi')

		expect((await message).data).toBe('echo:hi')

		await wsClosed(ws)
		app.stop()
	})

	it('sets ws.body when the handler reads it directly', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.send(`body:${ws.body}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('touched')

		expect((await message).data).toBe('body:touched')

		await wsClosed(ws)
		app.stop()
	})

	it('sets ws.body for a bound handler whose source cannot be inspected', async () => {
		// Bound functions expose native-code source, so body-use analysis must
		// conservatively assume the handler may read ws.body.
		function impl(this: unknown, ws: any) {
			ws.send(`bound-body:${ws.body}`)
		}
		const bound = impl.bind(null)

		const app = new Elysia()
			.ws('/ws', {
				message: bound as any
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('via-bound')

		expect((await message).data).toBe('bound-body:via-bound')

		await wsClosed(ws)
		app.stop()
	})

	it('sets ws.body when the handler passes ws to another function', async () => {
		const read = (w: any) => w.body
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.send(`fwd:${read(ws)}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('forwarded')

		expect((await message).data).toBe('fwd:forwarded')

		await wsClosed(ws)
		app.stop()
	})

	it('validates and sets ws.body when the handler only reads ws.body', async () => {
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({ n: t.Number() }),
				message(ws) {
					ws.send(JSON.stringify(ws.body))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send(JSON.stringify({ n: 5 }))

		expect((await message).data).toBe(JSON.stringify({ n: 5 }))

		await wsClosed(ws)
		app.stop()
	})

	it('makes ws.body available to response lifecycle hooks', async () => {
		const seen: string[] = []
		const app = new Elysia()
			.ws('/ws', {
				message() {
					return 'reply'
				},
				mapResponse(ws) {
					seen.push(`map:${ws.body}`)
				},
				afterHandle(ws) {
					seen.push(`afterHandle:${ws.body}`)
				},
				afterResponse(ws) {
					seen.push(`afterResponse:${ws.body}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('hook-body')
		await message

		expect(seen).toEqual([
			'map:hook-body',
			'afterHandle:hook-body',
			'afterResponse:hook-body'
		])

		await wsClosed(ws)
		app.stop()
	})

	it('makes the failing message body available to error hooks', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message() {
					throw new Error('boom')
				},
				error(ws: any) {
					return `error:${ws.body}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('failed-body')

		expect((await message).data).toBe('error:failed-body')

		await wsClosed(ws)
		app.stop()
	})
})
