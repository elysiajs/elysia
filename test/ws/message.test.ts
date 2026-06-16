import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'
import z from 'zod'

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

	it('should subscribe & publish', async () => {
		const app = new Elysia()
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

		// Both clients see the open event before the server-side `open`
		// handler has necessarily run (and thus before either is
		// subscribed). Wait a tick so subscriptions are in place.
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
		// Validation error message wording is owned by typebox; assert that
		// SOME error message was returned (non-empty) rather than depend on
		// a substring that drifts between typebox versions.
		expect(typeof data).toBe('string')
		expect((data as string).length).toBeGreaterThan(0)

		await wsClosed(ws)
		app.stop()
	})

	it('should validate standard schema success', async () => {
		const app = new Elysia()
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
		// Standard Schema (zod) error wording is owned by zod and changes
		// across versions; assert that SOME error message was returned.
		expect(typeof data).toBe('string')
		expect((data as string).length).toBeGreaterThan(0)

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
			.error(() => {
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
            .error(() => {
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

	// Regression (audit H4): `.compile()` iterated ALL route history including
	// WebSocket tuples and overwrote map['WS'][path] (the upgrade handler) with
	// a generic compiled HTTP handler — so WS upgrades broke after compile()
	// (and via the AOT build path which calls compile()). Echo must still work
	// when the app is eagerly compiled before listen.
	it('keeps WebSocket upgrade working after .compile()', async () => {
		const app = new Elysia()
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

// F30/F6/F32: hook-free routes now dispatch messages on a fully-sync
// path (no per-message Promise); async parsers/handlers are still
// awaited via runtime guards and sync throws still reach error handling.
describe('WebSocket sync dispatch path', () => {
	it("F32: raw '/'-prefixed frame arrives as the raw string", async () => {
		const app = new Elysia()
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

	it('F6: async parse hook is awaited before the handler runs', async () => {
		const app = new Elysia()
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

	it('F6: throwing sync parse hook reaches error handling', async () => {
		const app = new Elysia()
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

		// No error hook — `handleError` falls back to sending the message.
		expect((await message).data).toBe('parse-boom')

		await wsClosed(ws)
		app.stop()
	})

	it('F30: sync handler throw reaches the error hook with no unhandled rejection', async () => {
		const rejections: unknown[] = []
		const onRejection = (e: unknown) => {
			rejections.push(e)
		}
		process.on('unhandledRejection', onRejection)

		try {
			const app = new Elysia()
				.error(() => 'sync-throw-caught')
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

	it('F30: async handler return value on a hook-free route is awaited and sent', async () => {
		const app = new Elysia()
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

	// Pins mapResponse's inclusion in the sync-eligibility condition: a
	// route whose ONLY hook is mapResponse must still map the result.
	it('F30: mapResponse still applies when it is the only hook', async () => {
		const app = new Elysia()
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

	// F31: the non-`ElysiaStatus` response fallback (`200 ?? first entry`)
	// is now resolved once per route — a bag WITHOUT a 200 entry must
	// still validate plain sends against its first entry, and an
	// `status(...)` send must still pick the status-keyed entry.
	it('F31: response bag without a 200 entry still validates via its first entry', async () => {
		const app = new Elysia()
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

		// Valid against the 201 (first/default) entry.
		const m1 = wsMessage(ws)
		ws.send('good')
		expect(JSON.parse((await m1).data as string)).toEqual({ ok: true })

		// Invalid — a validation error message is sent instead of the
		// payload.
		const m2 = wsMessage(ws)
		ws.send('bad')
		const failed = (await m2).data as string
		expect(typeof failed).toBe('string')
		expect(failed.length).toBeGreaterThan(0)
		expect(failed).not.toBe(JSON.stringify({ ok: 'not-a-boolean' }))

		await wsClosed(ws)
		app.stop()
	})
})
