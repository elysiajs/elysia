import { describe, it, expect } from 'bun:test'
import { Elysia, t, getSchemaValidator } from '../../src'
import { createHandleWSResponse, ElysiaWS } from '../../src/ws'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'
import z from 'zod'

// ? Reported as #1933 and #1563
//
// ? Inbound message validation is covered by message.test.ts and refuses on a
// ? truthy check. The outbound path used to compare the same check against
// ? `false`, which rejected every valid TypeBox message and delivered every
// ? invalid one, and never fired at all for Standard Schema
const listen = async (app: Elysia<any, any, any, any, any, any, any, any>) => {
	app.listen(0)

	const ws = newWebsocket(app.server!)
	await wsOpen(ws)

	const message = wsMessage(ws)
	ws.send('trigger')

	const { data } = await message
	const received = String(data)

	await wsClosed(ws)
	app.stop()

	return {
		received,
		rejected: received.includes('"type": "validation"')
	}
}

const typebox = t.Object({ message: t.String() })
const standard = z.object({ message: z.string() })
const asyncStandard = standard.refine(async () => true)

const valid = { message: 'ok' }
const invalid = { wrong: 1 } as any

const createDirectWS = (validator: unknown, calls: unknown[][]) =>
	new ElysiaWS(
		{
			data: { validator },
			send(...args: unknown[]) {
				calls.push(['send', ...args])
				return 1
			},
			ping(...args: unknown[]) {
				calls.push(['ping', ...args])
				return 1
			},
			pong(...args: unknown[]) {
				calls.push(['pong', ...args])
				return 1
			},
			publish(...args: unknown[]) {
				calls.push(['publish', ...args])
				return 1
			},
			sendText() {},
			sendBinary() {},
			close() {},
			terminate() {},
			publishText() {},
			publishBinary() {},
			subscribe() {},
			unsubscribe() {},
			isSubscribed() {},
			cork() {},
			remoteAddress: '',
			binaryType: 'nodebuffer',
			subscriptions: []
		} as any,
		{} as any
	)

describe('WebSocket response validation', () => {
	it('awaits delayed validation before completing a non-generator response', async () => {
		const validation = Promise.withResolvers<boolean>()
		const handleResponse = createHandleWSResponse(
			getSchemaValidator(standard.refine(() => validation.promise))
		)
		const messages: string[] = []
		const ws = {
			send(data: string) {
				messages.push(data)
				return 1
			}
		} as Parameters<typeof handleResponse>[0]
		let completed = false
		const response = handleResponse(ws, valid).then(() => {
			completed = true
		})

		await Bun.sleep(0)
		const completedBeforeValidation = completed
		const messagesBeforeValidation = [...messages]
		validation.resolve(true)
		await response

		expect(completedBeforeValidation).toBe(false)
		expect(messagesBeforeValidation).toEqual([])
		expect(messages).toEqual([JSON.stringify(valid)])
	})

	it('propagates validator rejection from a non-generator response', async () => {
		const error = new Error('response validation failed')
		const handleResponse = createHandleWSResponse(
			getSchemaValidator({
				'~standard': {
					version: 1,
					vendor: 'test',
					types: undefined,
					async validate() {
						await Bun.sleep(0)
						throw error
					}
				}
			})
		)
		const messages: string[] = []
		const ws = {
			send(data: string) {
				messages.push(data)
				return 1
			}
		} as Parameters<typeof handleResponse>[0]

		await expect(handleResponse(ws, valid)).rejects.toBe(error)
		expect(messages).toEqual([])
	})

	it('sends a valid TypeBox message', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: typebox,
				message: () => valid
			})
		)

		expect(rejected).toBe(false)
		expect(received).toBe(JSON.stringify(valid))
	})

	it('refuses an invalid TypeBox message', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: typebox,
				message: () => invalid
			})
		)

		expect(rejected).toBe(true)
		// ? The client must receive the error frame, not the payload. The
		// ? frame echoes the payload under `found`, so compare delivery
		expect(received).not.toBe(JSON.stringify(invalid))
	})

	it('sends a valid standard schema message', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: standard,
				message: () => valid
			})
		)

		expect(rejected).toBe(false)
		expect(received).toBe(JSON.stringify(valid))
	})

	it('sends the transformed standard schema value from ws.send', async () => {
		const transformed = standard.transform(({ message }) => ({
			message: message.toUpperCase()
		}))
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: transformed,
				message: (ws) => {
					ws.send({ message: 'ok', secret: 'hidden' } as any)
				}
			})
		)

		expect(rejected).toBe(false)
		expect(received).toBe(JSON.stringify({ message: 'OK' }))
	})

	it('sends the transformed async standard schema value', async () => {
		const transformed = standard.transform(async ({ message }) => ({
			message: message.toUpperCase()
		}))
		const handleResponse = createHandleWSResponse(
			getSchemaValidator(transformed)
		)
		const messages: string[] = []
		const ws = {
			send(data: string) {
				messages.push(data)
				return 1
			}
		} as Parameters<typeof handleResponse>[0]

		await handleResponse(ws, { message: 'ok', secret: 'hidden' })

		expect(messages).toEqual([JSON.stringify({ message: 'OK' })])
	})

	it('preserves direct method semantics after transforming to undefined', () => {
		const calls: unknown[][] = []
		const ws = createDirectWS(
			getSchemaValidator(z.string().transform(() => undefined)),
			calls
		)

		expect(ws.send('message')).toBe(0)
		expect(ws.ping('message')).toBe(1)
		expect(ws.pong('message')).toBe(1)
		expect(ws.publish('topic', 'message')).toBe(0)
		expect(calls).toEqual([
			['ping', undefined],
			['pong', undefined]
		])
	})

	it('sends transformed Buffer values as binary from direct methods', () => {
		const calls: unknown[][] = []
		const transformed = Buffer.from([1, 2, 3])
		const ws = createDirectWS(
			getSchemaValidator(z.string().transform(() => transformed)),
			calls
		)

		ws.send('message')
		ws.ping('message')
		ws.pong('message')
		ws.publish('topic', 'message')

		expect(calls).toEqual([
			['send', transformed, undefined],
			['ping', transformed],
			['pong', transformed],
			['publish', 'topic', transformed, undefined]
		])
	})

	it('omits async responses transformed to undefined', async () => {
		const handleResponse = createHandleWSResponse(
			getSchemaValidator(z.string().transform(async () => undefined))
		)
		const messages: unknown[] = []
		const ws = {
			send(data: unknown) {
				messages.push(data)
				return 1
			}
		} as Parameters<typeof handleResponse>[0]

		await handleResponse(ws, 'message')

		expect(messages).toHaveLength(0)
	})

	it('sends async responses transformed to Buffer as binary', async () => {
		const transformed = Buffer.from([1, 2, 3])
		const handleResponse = createHandleWSResponse(
			getSchemaValidator(z.string().transform(async () => transformed))
		)
		const messages: unknown[] = []
		const ws = {
			send(data: unknown) {
				messages.push(data)
				return 1
			}
		} as Parameters<typeof handleResponse>[0]

		await handleResponse(ws, 'message')

		expect(messages).toEqual([transformed])
	})

	it('refuses an invalid standard schema message', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: standard,
				message: () => invalid
			})
		)

		expect(rejected).toBe(true)
		expect(received).not.toBe(JSON.stringify(invalid))
	})

	it('sends a valid message from a generator', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: typebox,
				*message() {
					yield valid
				}
			})
		)

		expect(rejected).toBe(false)
		expect(received).toBe(JSON.stringify(valid))
	})

	it('refuses an invalid message from a generator', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: typebox,
				*message() {
					yield invalid
				}
			})
		)

		expect(rejected).toBe(true)
		expect(received).not.toBe(JSON.stringify(invalid))
	})

	// ? The async branch validated the `{ value, done }` iterator result
	// ? rather than the yielded value, so every message failed the schema
	it('sends a valid message from an async generator', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: typebox,
				async *message() {
					yield valid
				}
			})
		)

		expect(rejected).toBe(false)
		expect(received).toBe(JSON.stringify(valid))
	})

	it('refuses an invalid message from an async generator', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: typebox,
				async *message() {
					yield invalid
				}
			})
		)

		expect(rejected).toBe(true)
		expect(received).not.toBe(JSON.stringify(invalid))
	})

	// ? ws.send, ping, pong and publish validate separately from the value
	// ? returned by the handler, and only understood TypeBox
	it('refuses an invalid standard schema message sent by ws.send', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: standard,
				message: (ws) => {
					ws.send(invalid)
				}
			})
		)

		expect(rejected).toBe(true)
		expect(received).not.toBe(JSON.stringify(invalid))
	})

	it('awaits an async response schema returned by a handler', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: asyncStandard,
				message: () => valid
			})
		)

		expect(rejected).toBe(false)
		expect(received).toBe(JSON.stringify(valid))
	})

	it('refuses an invalid async response returned by a handler', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: standard.refine(async () => false),
				message: () => valid
			})
		)

		expect(rejected).toBe(true)
		expect(received).not.toBe(JSON.stringify(valid))
	})

	it('fails closed for an async response schema used by ws.send', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: asyncStandard,
				message: (ws) => {
					ws.send(valid)
				}
			})
		)

		expect(rejected).toBe(true)
		expect(received).not.toBe(JSON.stringify(valid))
	})

	it('fails closed for an async response schema used by ws.publish', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: asyncStandard,
				message: (ws) => {
					ws.publish('topic', valid)
				}
			})
		)

		expect(rejected).toBe(true)
		expect(received).not.toBe(JSON.stringify(valid))
	})

	it('refuses an invalid standard schema message sent by ws.publish', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: standard,
				message: (ws) => {
					ws.publish('topic', invalid)
				}
			})
		)

		expect(rejected).toBe(true)
		expect(received).not.toBe(JSON.stringify(invalid))
	})

	it('sends a valid message by ws.send', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				response: typebox,
				message: (ws) => {
					ws.send(valid)
				}
			})
		)

		expect(rejected).toBe(false)
		expect(received).toBe(JSON.stringify(valid))
	})

	it('does not validate when no response schema is provided', async () => {
		const { received, rejected } = await listen(
			new Elysia().ws('/ws', {
				message: () => invalid
			})
		)

		expect(rejected).toBe(false)
		expect(received).toBe(JSON.stringify(invalid))
	})
})
