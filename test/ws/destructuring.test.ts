import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

describe('WebSocket subscriptions getter', () => {
	it('ws.subscriptions reflects current state after subscribe/unsubscribe', async () => {
		let snapshot: string[] = []

		const app = new Elysia()
			.ws('/ws', {
				open(ws: any) {
					ws.subscribe('a')
					ws.subscribe('b')
				},
				message(ws: any, body: any) {
					if (body === 'drop-a') ws.unsubscribe('a')
					snapshot = [...ws.subscriptions]
					ws.send(JSON.stringify(snapshot))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const m1 = wsMessage(ws)
		ws.send('check')
		expect(JSON.parse((await m1).data as string).sort()).toEqual(['a', 'b'])

		const m2 = wsMessage(ws)
		ws.send('drop-a')
		expect(JSON.parse((await m2).data as string)).toEqual(['b'])

		await wsClosed(ws)
		app.stop()
	})
})

describe('WebSocket destructuring', () => {
	it('should destructure', async () => {
		const app = new Elysia()
			.ws('/ws', {
				async open(ws) {
					const {
						subscribe,
						isSubscribed,
						publish,
						unsubscribe,
						cork,
						send,
						// close,
						// terminate
					} = ws

					subscribe('asdf')
					const subscribed = isSubscribed('asdf')
					publish('asdf', 'data')
					unsubscribe('asdf')
					cork(() => ws)
					send('Hello!' + subscribed)
					// malloc error on macOS
					// close()
					// terminate()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		const message = wsMessage(ws)

		await wsOpen(ws)

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('Hello!true')

		await wsClosed(ws)
		app.stop()
	})
})
