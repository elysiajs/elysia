import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

describe('WebSocket message', () => {
	it('should send & receive', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, message) {
					ws.send(message)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('Hello!')

		await wsClosed(ws)
		app.stop()
	})

	it('should respond with remoteAddress', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.send(ws.remoteAddress)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data === '::1' || data === '::ffff:127.0.0.1').toBeTruthy()

		await wsClosed(ws)
		app.stop()
	})

	// it('should subscribe & publish', async () => {
	// 	const app = new Elysia()
	// 		.ws('/ws', {
	// 			open(ws) {
	// 				ws.subscribe('asdf')
	// 			},
	// 			message(ws) {
	// 				ws.publish('asdf', ws.isSubscribed('asdf'))
	// 			}
	// 		})
	// 		.listen(0)

	// 	const wsBob = newWebsocket(app.server!)
	// 	const wsAlice = newWebsocket(app.server!)

	// 	await wsOpen(wsBob)
	// 	await wsOpen(wsAlice)

	// 	const messageBob = wsMessage(wsBob)

	// 	wsAlice.send('Hello!')

	// 	const { type, data } = await messageBob

	// 	expect(type).toBe('message')
	// 	expect(data).toBe('true')

	// 	await wsClosed(wsBob)
	// 	await wsClosed(wsAlice)
	// 	app.stop()
	// })

	it('should unsubscribe', async () => {
		const app = new Elysia()
			.ws('/ws', {
				open(ws) {
					ws.subscribe('asdf')
				},
				message(ws, message) {
					if (message === 'unsubscribe') {
						ws.unsubscribe('asdf')
					}

					ws.send(ws.isSubscribed('asdf'))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const subscribedMessage = wsMessage(ws)

		ws.send('Hello!')

		const subscribed = await subscribedMessage

		expect(subscribed.type).toBe('message')
		expect(subscribed.data).toBe('true')

		const unsubscribedMessage = wsMessage(ws)

		ws.send('unsubscribe')

		const unsubscribed = await unsubscribedMessage

		expect(unsubscribed.type).toBe('message')
		expect(unsubscribed.data).toBe('false')

		await wsClosed(ws)
		app.stop()
	})

	it('should validate success', async () => {
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({
					message: t.String()
				}),
				message(ws, { message }) {
					ws.send(message)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify({ message: 'Hello!' }))

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('Hello!')

		await wsClosed(ws)
		app.stop()
	})

	it('should validate fail', async () => {
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({
					message: t.String()
				}),
				message(ws, { message }) {
					ws.send(message)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toInclude('Expected')

		await wsClosed(ws)
		app.stop()
	})

	it('should parse objects', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, raw) {
					ws.send(raw)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify({ message: 'Hello!' }))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('{"message":"Hello!"}')

		await wsClosed(ws)
		app.stop()
	})

	it('should parse arrays', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, raw) {
					ws.send(JSON.stringify(raw))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify([{ message: 'Hello!' }]))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('[{"message":"Hello!"}]')

		await wsClosed(ws)
		app.stop()
	})

	it('should parse strings', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, raw) {
					ws.send(JSON.stringify(raw))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify("Hello!"))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('"Hello!"')

		await wsClosed(ws)
		app.stop()
	})

	it('should parse numbers', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, raw) {
					ws.send(JSON.stringify(raw))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify(1234567890))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('1234567890')

		await wsClosed(ws)
		app.stop()
	})

	it('should parse true', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, raw) {
					ws.send(JSON.stringify(raw))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify(true))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('true')

		await wsClosed(ws)
		app.stop()
	})

	it('should parse false', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, raw) {
					ws.send(JSON.stringify(raw))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify(false))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('false')

		await wsClosed(ws)
		app.stop()
	})

	it('should parse null', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, raw) {
					ws.send(JSON.stringify(raw))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify(null))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('null')

		await wsClosed(ws)
		app.stop()
	})

	it('should parse not parse /hello', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, raw) {
					ws.send(JSON.stringify(raw))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify("/hello"))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('/hello')

		await wsClosed(ws)
		app.stop()
	})

	it('should send from plugin', async () => {
		const plugin = new Elysia().ws('/ws', {
			message(ws, message) {
				ws.send(message)
			}
		})

		const app = new Elysia().use(plugin).listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('Hello!')

		await wsClosed(ws)
		app.stop()
	})

	it('should be able to receive binary data', async () => {
		const plugin = new Elysia().ws('/ws', {
			message(ws, message) {
				ws.send(message)
			}
		})

		const app = new Elysia().use(plugin).listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(new Uint8Array(3))

		const { type, data } = await message

		expect(type).toBe('message')
		// @ts-ignore
		expect(data).toEqual(new Uint8Array(3))

		await wsClosed(ws)
		app.stop()
	})

	it('should send & receive', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, message) {
					ws.send(message)
				}
			})
			.listen(0)
		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		const message = wsMessage(ws)
		ws.send(' ')
		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toBe(' ')
		await wsClosed(ws)
		app.stop()
	})

	it('handle error', async () => {
		const app = new Elysia()
			.ws('/ws', {
				error() {
					return 'caught'
				},
				message(ws, message) {
					throw new Error('A')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('caught')

		await wsClosed(ws)
		app.stop()
	})

	it('handle error with onError', async () => {
		const app = new Elysia()
			.onError(() => {
				return 'caught'
			})
			.ws('/ws', {
				message(ws, message) {
					throw new Error('A')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send('Hello!')

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('caught')

		await wsClosed(ws)
		app.stop()
	})

    it('handle validation error with onError', async () => {
        const app = new Elysia()
            .onError(() => {
                return 'caught'
            })
            .ws('/ws', {
                body: t.Object({
                    name: t.String()
                }),
                message(ws, message) {
                    return ws.send(message)
                }
            })
            .listen(0)

        const ws = newWebsocket(app.server!)

        await wsOpen(ws)

        const message = wsMessage(ws)

        ws.send(JSON.stringify({
            name: 123, // expecting a string
        }))

        const { type, data } = await message

        expect(type).toBe('message')
        expect(data).toBe('caught')

        await wsClosed(ws)
        app.stop()
    })
})
