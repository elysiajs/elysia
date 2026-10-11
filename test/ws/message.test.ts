import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'
import z from 'zod'

describe('WebSocket message', () => {
	it('should send & receive', async () => {
		const app = new Elysia()
			.use(websocket())
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
			.use(websocket())
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

	it('should subscribe & publish', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				open(ws) {
					ws.subscribe('asdf')
				},
				message(ws) {
					ws.publish('asdf', String(ws.isSubscribed('asdf')))
				}
			})
			.listen(0)

		const wsBob = newWebsocket(app.server!)
		const wsAlice = newWebsocket(app.server!)

		await wsOpen(wsBob)
		await wsOpen(wsAlice)

		// Client open events may precede the server subscription hooks.
		await Bun.sleep(50)

		const messageBob = wsMessage(wsBob)

		wsAlice.send('Hello!')

		const { type, data } = await messageBob

		expect(type).toBe('message')
		expect(data).toBe('true')

		await wsClosed(wsBob)
		await wsClosed(wsAlice)
		app.stop()
	})

	it('should unsubscribe', async () => {
		const app = new Elysia()
			.use(websocket())
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
			.use(websocket())
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
			.use(websocket())
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
		// TypeBox error wording is not part of this contract.
		expect(typeof data).toBe('string')
		expect((data as string).length).toBeGreaterThan(0)

		await wsClosed(ws)
		app.stop()
	})

	it('should validate standard schema success', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				body: z.object({
					message: z.string()
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

	it('should validate standard schema fail', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				body: z.object({
					message: z.string()
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
		// Zod error wording is not part of this contract.
		expect(typeof data).toBe('string')
		expect((data as string).length).toBeGreaterThan(0)

		await wsClosed(ws)
		app.stop()
	})

	it('should parse objects', async () => {
		const app = new Elysia()
			.use(websocket())
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
			.use(websocket())
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
			.use(websocket())
			.ws('/ws', {
				message(ws, raw) {
					ws.send(JSON.stringify(raw))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify('Hello!'))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('"Hello!"')

		await wsClosed(ws)
		app.stop()
	})

	it('should parse numbers', async () => {
		const app = new Elysia()
			.use(websocket())
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
			.use(websocket())
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
			.use(websocket())
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
			.use(websocket())
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
			.use(websocket())
			.ws('/ws', {
				message(ws, raw) {
					ws.send(JSON.stringify(raw))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)

		ws.send(JSON.stringify('/hello'))

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toInclude('/hello')

		await wsClosed(ws)
		app.stop()
	})

	it('should send from plugin', async () => {
		const plugin = new Elysia().use(websocket()).ws('/ws', {
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
		const plugin = new Elysia().use(websocket()).ws('/ws', {
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

	it('should send & receive a whitespace-only message verbatim', async () => {
		const app = new Elysia()
			.use(websocket())
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
			.use(websocket())
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
			.use(websocket())
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
			.use(websocket())
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

		ws.send(
			JSON.stringify({
				name: 123 // expecting a string
			})
		)

		const { type, data } = await message

		expect(type).toBe('message')
		expect(data).toBe('caught')

		await wsClosed(ws)
		app.stop()
	})

	it('keeps WebSocket upgrade working after .compile()', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message(ws, message) {
					ws.send(message)
				}
			})
			.compile()
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('after-compile')

		const { type, data } = await message
		expect(type).toBe('message')
		expect(data).toBe('after-compile')

		await wsClosed(ws)
		app.stop()
	})
})

// Hook-free routes dispatch synchronously while still supporting async work.
describe('WebSocket sync dispatch path', () => {
	it("raw '/'-prefixed frame arrives as the raw string", async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message(ws, message) {
					ws.send(
						JSON.stringify({ got: message, type: typeof message })
					)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('/join general')

		expect(JSON.parse((await message).data as string)).toEqual({
			got: '/join general',
			type: 'string'
		})

		await wsClosed(ws)
		app.stop()
	})

	it('async parse hook is awaited before the handler runs', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				parse: async (_ws, message) => {
					await Bun.sleep(5)
					return `${message}-parsed`
				},
				message(ws, message) {
					ws.send(message as string)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('hello')

		expect((await message).data).toBe('hello-parsed')

		await wsClosed(ws)
		app.stop()
	})

	it('throwing sync parse hook reaches error handling', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				parse() {
					throw new Error('parse-boom')
				},
				message(ws) {
					ws.send('should-not-run')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('x')

		// Without an error hook, the client receives the default problem body.
		const body = JSON.parse((await message).data as string)
		expect(body).toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'parse-boom'
		})

		await wsClosed(ws)
		app.stop()
	})

	it('sync handler throw reaches the error hook with no unhandled rejection', async () => {
		const rejections: unknown[] = []
		const onRejection = (e: unknown) => {
			rejections.push(e)
		}
		process.on('unhandledRejection', onRejection)

		try {
			const app = new Elysia()
				.onError(() => 'sync-throw-caught')
				.use(websocket())
				.ws('/ws', {
					message() {
						throw new Error('boom')
					}
				})
				.listen(0)

			const ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const message = wsMessage(ws)
			ws.send('x')

			expect((await message).data).toBe('sync-throw-caught')

			await wsClosed(ws)
			app.stop()

			// Give any stray rejection a tick to surface.
			await Bun.sleep(10)
			expect(rejections).toEqual([])
		} finally {
			process.off('unhandledRejection', onRejection)
		}
	})

	it('async handler return value on a hook-free route is awaited and sent', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				async message(_ws, message) {
					await Bun.sleep(5)
					return `async-${message}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('x')

		expect((await message).data).toBe('async-x')

		await wsClosed(ws)
		app.stop()
	})

	it('mapResponse still applies when it is the only hook', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message(_ws, message) {
					return `m-${message}`
				},
				mapResponse({ responseValue }: any): any {
					return `mapped-${responseValue}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('x')

		expect((await message).data).toBe('mapped-m-x')

		await wsClosed(ws)
		app.stop()
	})

	// Without a 200 schema, plain responses use the first registered validator.
	it('uses the first response schema when no 200 schema is registered', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				response: {
					201: t.Object({ ok: t.Boolean() })
				},
				message({ body }: any): any {
					if (body === 'bad') return { ok: 'not-a-boolean' }
					return { ok: true }
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const m1 = wsMessage(ws)
		ws.send('good')
		expect(JSON.parse((await m1).data as string)).toEqual({ ok: true })

		const m2 = wsMessage(ws)
		ws.send('bad')
		const failed = (await m2).data as string
		expect(typeof failed).toBe('string')
		expect(failed.length).toBeGreaterThan(0)
		expect(failed).not.toBe(JSON.stringify({ ok: 'not-a-boolean' }))

		await wsClosed(ws)
		app.stop()
	})

	// HTTP assimilates any thenable a handler or hook returns; a value that
	// only looks like one (a `then` that is not callable) is a payload
	it('awaits a hand-written thenable from the handler on the hook-free lane', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message: () => ({
					then(resolve: (value: string) => void) {
						resolve('from-thenable')
					}
				})
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('x')
		expect((await message).data).toBe('from-thenable')

		await wsClosed(ws)
		app.stop()
	})

	it('awaits a hand-written thenable from the handler and from a hook on the full lane', async () => {
		const thenable = (value: unknown) => ({
			then(resolve: (value: unknown) => void) {
				resolve(value)
			}
		})
		const app = new Elysia()
			.use(websocket())
			.ws('/handler', {
				transform() {},
				message: () => thenable('from-handler')
			})
			// resolves to nothing: the hook must not short-circuit
			.ws('/hook-passes', {
				beforeHandle: () => thenable(undefined),
				message: () => 'from-handler'
			})
			// answers per message only: at the upgrade `body` is empty
			.ws('/hook-answers', {
				beforeHandle: ({ body }: any) =>
					body ? thenable('from-hook') : undefined,
				message: () => 'never'
			})
			.listen(0)

		for (const [path, expected] of [
			['/handler', 'from-handler'],
			['/hook-passes', 'from-handler'],
			['/hook-answers', 'from-hook']
		]) {
			const ws = newWebsocket(app.server!, path)
			await wsOpen(ws)

			const message = wsMessage(ws)
			ws.send('x')
			expect((await message).data).toBe(expected)

			await wsClosed(ws)
		}

		app.stop()
	})

	it('serializes an object whose `then` is not callable as JSON', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message: () => ({ then: 'not-a-function', v: 1 })
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('x')
		expect((await message).data).toBe('{"then":"not-a-function","v":1}')

		await wsClosed(ws)
		app.stop()
	})

	// a custom iterator may hand back any thenable from next() or return(),
	// as HTTP's stream pull accepts: each is awaited, not read as a step
	it("assimilates a thenable from a custom iterator's next and return", async () => {
		const log: string[] = []
		const thenable = (value: unknown) => ({
			then(resolve: (value: unknown) => void) {
				log.push('then')
				resolve(value)
			}
		})
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message() {
					let n = 0

					return {
						next() {
							log.push(`next${++n}`)
							if (n > 3) return { done: true, value: undefined }

							return n <= 2
								? thenable({ done: false, value: `chunk-${n}` })
								: thenable({ done: true, value: undefined })
						},
						return() {
							log.push('return')

							return thenable({ done: true, value: undefined })
						},
						[Symbol.asyncIterator]() {
							return this
						}
					}
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const frames: unknown[] = []
		ws.addEventListener('message', (event) => frames.push(event.data))
		ws.send('x')
		await Bun.sleep(20)

		expect(frames).toEqual(['chunk-1', 'chunk-2'])
		expect(log).toEqual([
			'next1',
			'then',
			'next2',
			'then',
			'next3',
			'then',
			'return',
			'then'
		])

		await wsClosed(ws)
		app.stop()
	})

	// a native Promise is awaited even when an own `then` shadows the
	// method: `await` settles it regardless, so it is never read as a step
	it('awaits a native Promise from a custom iterator despite a shadowed then', async () => {
		const shadowed = (value: unknown) => {
			const promise = Promise.resolve(value)
			Object.defineProperty(promise, 'then', { value: 'shadow' })

			return promise
		}
		let nextCalls = 0
		let returnCalls = 0
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message() {
					return {
						next() {
							if (++nextCalls > 3)
								return { done: true, value: undefined }

							return shadowed(
								nextCalls <= 2
									? {
											done: false,
											value: `chunk-${nextCalls}`
										}
									: { done: true, value: undefined }
							)
						},
						return() {
							returnCalls++

							return shadowed({ done: true, value: undefined })
						},
						[Symbol.asyncIterator]() {
							return this
						}
					}
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const frames: unknown[] = []
		ws.addEventListener('message', (event) => frames.push(event.data))
		ws.send('x')
		await Bun.sleep(20)

		expect(frames).toEqual(['chunk-1', 'chunk-2'])
		// two yields and the done step: one next() each
		expect(nextCalls).toBe(3)
		expect(returnCalls).toBe(1)

		await wsClosed(ws)
		app.stop()
	})
})
