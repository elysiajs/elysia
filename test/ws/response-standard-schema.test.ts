import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { RouteValidator } from '../../src/validator/route'
import { ElysiaWS } from '../../src/ws'
import { handleWSResponse } from '../../src/ws/route'
import { newWebsocket, wsClosed, wsMessage, wsOpen } from './utils'

const standard = (
	validate: (value: unknown) =>
		| { value: unknown }
		| { issues: unknown[] }
		| Promise<{ value: unknown } | { issues: unknown[] }>
) => ({
	'~standard': {
		version: 1,
		vendor: 'test',
		validate
	}
})

function createWS(validate: Parameters<typeof standard>[0]) {
	const validator = new RouteValidator({
		response: standard(validate)
	} as any).response!
	const calls: Record<string, unknown[][]> = {
		send: [],
		ping: [],
		pong: [],
		publish: []
	}
	const record =
		(name: keyof typeof calls) =>
		(...args: unknown[]) => {
			calls[name].push(args)
			return 1
		}
	const raw: any = {
		data: {
			validator,
			defaultValidator: validator.get(200)
		},
		readyState: 1,
		subscriptions: [],
		send: record('send'),
		ping: record('ping'),
		pong: record('pong'),
		publish: record('publish')
	}

	return { ws: new ElysiaWS(raw), calls }
}

describe('WebSocket Standard Schema responses', () => {
	it('reclassifies synchronous transformations in direct methods', () => {
		const omitted = createWS(() => ({ value: undefined }))

		expect(omitted.ws.send('secret')).toBe(0)
		expect(omitted.ws.ping('secret')).toBe(1)
		expect(omitted.ws.pong('secret')).toBe(1)
		expect(omitted.ws.publish('topic', 'secret')).toBe(0)
		expect(omitted.calls).toEqual({
			send: [],
			ping: [[]],
			pong: [[]],
			publish: []
		})

		const bytes = new Uint8Array([1, 2, 3])
		const binary = createWS(() => ({ value: bytes }))
		binary.ws.send('message')
		binary.ws.ping('message')
		binary.ws.pong('message')
		binary.ws.publish('topic', 'message')

		expect(binary.calls).toEqual({
			send: [[bytes, undefined]],
			ping: [[bytes]],
			pong: [[bytes]],
			publish: [['topic', bytes, undefined]]
		})
	})

	it('fails closed when a direct method encounters async validation', () => {
		const { ws, calls } = createWS(async () => ({ value: 'validated' }))

		expect(ws.send('secret')).toBe(1)
		expect(ws.ping('secret')).toBe(1)
		expect(ws.pong('secret')).toBe(1)
		expect(ws.publish('topic', 'secret')).toBe(1)
		expect(calls.send).toHaveLength(4)
		expect(calls.ping).toHaveLength(0)
		expect(calls.pong).toHaveLength(0)
		expect(calls.publish).toHaveLength(0)
		for (const [frame] of calls.send) {
			expect(frame).not.toBe('secret')
			expect(String(frame)).toContain(
				'Asynchronous Standard Schema validation is not supported'
			)
		}
	})

	it('awaits transformations for handler and generator responses', async () => {
		const { ws, calls } = createWS(async (value) => ({
			value:
				value === 'omit'
					? undefined
					: new TextEncoder().encode(String(value))
		}))

		await handleWSResponse(ws, 'omit', [])
		await handleWSResponse(
			ws,
			(function* () {
				yield 'omit'
				yield 'first'
				yield 'second'
			})(),
			[]
		)

		expect(calls.send).toHaveLength(2)
		expect(Array.from(calls.send[0][0] as Uint8Array)).toEqual(
			Array.from(new TextEncoder().encode('first'))
		)
		expect(Array.from(calls.send[1][0] as Uint8Array)).toEqual(
			Array.from(new TextEncoder().encode('second'))
		)
	})

	it('awaits async transformations from a synchronous message handler', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				response: standard(async (value) => ({
					value:
						value === 'omit'
							? undefined
							: new TextEncoder().encode(String(value))
				})) as any,
				message: ({ body }: any) => body
			})
			.listen(0)
		const ws = newWebsocket(app.server!)
		ws.binaryType = 'arraybuffer'

		try {
			await wsOpen(ws)
			const message = wsMessage(ws)
			ws.send('omit')
			await Bun.sleep(10)
			ws.send('visible')

			const data = (await message).data
			const bytes =
				data instanceof Blob
					? new Uint8Array(await data.arrayBuffer())
					: new Uint8Array(data as ArrayBuffer)
			expect(Array.from(bytes)).toEqual(
				Array.from(new TextEncoder().encode('visible'))
			)
		} finally {
			await wsClosed(ws)
			app.stop()
		}
	})
})

describe('WebSocket responses fail closed', () => {
	const leak = { id: 'u1', passwordHash: 'SECRET' }

	// every frame the client got until the socket answered once
	const exchange = async (app: any) => {
		app.listen(0)
		const ws = newWebsocket(app.server!)
		ws.binaryType = 'arraybuffer'

		try {
			await wsOpen(ws)
			const message = wsMessage(ws)
			ws.send('go')

			const { data } = await message

			return typeof data === 'string'
				? data
				: new TextDecoder().decode(data as unknown as ArrayBuffer)
		} finally {
			await wsClosed(ws)
			app.stop(true)
		}
	}

	const sanitized = () =>
		new Elysia({
			sanitize: () => {
				throw new Error('sanitizer failed')
			}
		}).use(websocket())

	const response = t.Object({ id: t.String(), name: t.String() })
	const value = { ...leak, name: 'n' }

	it('does not send the raw value when a sanitizer throws', async () => {
		const frame = await exchange(
			sanitized().ws('/ws', { response, message: () => value })
		)

		expect(frame).not.toContain('SECRET')
		expect(frame).not.toContain('u1')
	})

	it('does not send the raw value from ws.send when a sanitizer throws', async () => {
		const frame = await exchange(
			sanitized().ws('/ws', {
				response,
				message(ws) {
					ws.send(value)
				}
			})
		)

		expect(frame).not.toContain('SECRET')
		expect(frame).not.toContain('u1')
	})

	const binary = (text: string) => new TextEncoder().encode(text)

	for (const [name, answer] of [
		[
			'Response',
			() =>
				new Response(binary('SECRET'), {
					headers: { 'content-type': 'application/octet-stream' }
				})
		],
		['Blob', () => new Blob([binary('SECRET')])],
		['Uint8Array', () => binary('SECRET')],
		['async Uint8Array', async () => binary('SECRET')]
	] as const) {
		it(`validates a binary ${name} answer against the response schema`, async () => {
			const frame = await exchange(
				new Elysia().use(websocket()).ws('/ws', {
					response: t.Literal('ok'),
					message: answer as any
				})
			)

			expect(frame).not.toContain('SECRET')
		})

		it(`sends a binary ${name} answer with no response schema`, async () => {
			const frame = await exchange(
				new Elysia().use(websocket()).ws('/ws', {
					message: answer as any
				})
			)

			expect(frame).toBe('SECRET')
		})
	}

	it('keeps explicit binary ws.send outside the response schema', async () => {
		const frame = await exchange(
			new Elysia().use(websocket()).ws('/ws', {
				response: t.Literal('ok'),
				message(ws) {
					ws.send(binary('raw'))
				}
			})
		)

		expect(frame).toBe('raw')
	})
})
