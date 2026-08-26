import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
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

const valid = { message: 'ok' }
const invalid = { wrong: 1 } as any

describe('WebSocket response validation', () => {
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
