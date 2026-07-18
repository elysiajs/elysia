import { describe, expect, it } from 'bun:test'

import { Elysia, status, t } from '../../src'
import { validationPlan } from '../../src/experimental/validation-plan'
import { ElysiaWS } from '../../src/ws/context'
import { newWebsocket, wsClosed, wsMessage, wsOpen } from './utils'

const mockSocket = (validator: any, defaultValidator = validator) => {
	const calls: Array<[string, ...unknown[]]> = []
	const raw = {
		data: { validator: { 200: validator }, defaultValidator },
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
		}
	}

	return { ws: new ElysiaWS(raw as any), calls }
}

describe('WebSocket response encoding', () => {
	it('keeps Check/Errors-only validator compatibility', () => {
		const { ws, calls } = mockSocket({
			Check: () => true,
			Errors: () => []
		})

		ws.send({ legacy: true } as any)
		expect(calls[0][1]).toBe('{"legacy":true}')
	})

	it('encodes send, ping, pong, and publish exactly once before serialization', () => {
		let calls = 0
		const validator = {
			EncodeFrom(value: any) {
				calls++
				return { encoded: value.value }
			},
			Check: () => true,
			Errors: () => []
		}
		const { ws, calls: rawCalls } = mockSocket(validator)

		ws.send({ value: 'send' } as any)
		ws.ping({ value: 'ping' } as any)
		ws.pong({ value: 'pong' } as any)
		ws.publish('topic', { value: 'publish' } as any)

		expect(calls).toBe(4)
		expect(rawCalls).toEqual([
			['send', '{"encoded":"send"}', undefined],
			['ping', '{"encoded":"ping"}'],
			['pong', '{"encoded":"pong"}'],
			['publish', 'topic', '{"encoded":"publish"}', undefined]
		])
	})

	it('selects the status validator and preserves status framing', () => {
		const ok = {
			EncodeFrom: () => ({ branch: 'ok' }),
			Check: () => true,
			Errors: () => []
		}
		const created = {
			EncodeFrom: () => ({ branch: 'created' }),
			Check: () => true,
			Errors: () => []
		}
		const { ws, calls } = mockSocket(ok)
		;(ws.raw.data as any).validator[201] = created

		ws.send(status(201, { ignored: true }) as any)

		expect(JSON.parse(calls[0][1] as string)).toEqual({
			status: 201,
			error: { branch: 'created' }
		})

		created.EncodeFrom = () => new Uint8Array([7]) as any
		ws.send(status(201, { ignored: true }) as any)
		expect(JSON.parse(calls[1][1] as string)).toEqual({
			status: 201,
			error: { 0: 7 }
		})
	})

	it('fails loud when a sync WebSocket validator returns a custom thenable', () => {
		const validator = {
			EncodeFrom: () => ({ then() {} }),
			Check: () => true,
			Errors: () => []
		}
		const { ws, calls } = mockSocket(validator)

		expect(() => ws.send('value')).toThrow('asynchronous Standard Schema')
		expect(calls).toHaveLength(0)
	})

	it('observes rejected async validation and preserves binary passthrough', async () => {
		let validatorCalls = 0
		const validator = {
			EncodeFrom() {
				validatorCalls++
				return Promise.reject(new Error('rejected'))
			},
			Check: () => true,
			Errors: () => []
		}
		const { ws, calls } = mockSocket(validator)
		let unhandled = 0
		const onUnhandled = () => unhandled++
		process.on('unhandledRejection', onUnhandled)

		try {
			expect(() => ws.send('value')).toThrow(
				'asynchronous Standard Schema'
			)
			await Bun.sleep(0)
			expect(unhandled).toBe(0)

			const bytes = new Uint8Array([1, 2, 3])
			ws.send(bytes)
			expect(validatorCalls).toBe(1)
			expect(calls.at(-1)?.[1]).toBe(bytes)
		} finally {
			process.off('unhandledRejection', onUnhandled)
		}
	})

	it('routes unexpected response-validator faults through error hooks', async () => {
		let validations = 0
		let errorHooks = 0
		const response = {
			'~standard': {
				version: 1,
				vendor: 'response-fault',
				validate(value: unknown) {
					if (validations++ === 0) throw new Error('secret')
					return { value }
				}
			}
		}
		const app = new Elysia()
			.ws('/ws', {
				response: response as any,
				message() {
					return 'payload'
				},
				error() {
					errorHooks++
					return 'caught'
				}
			})
			.listen(0)
		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('go')
		expect((await message).data).toBe('caught')
		expect(errorHooks).toBe(1)

		await wsClosed(ws)
		app.stop()
	})

	it('encodes a codec response once over a real socket', async () => {
		let encodes = 0
		const Coded = t
			.Codec(t.String())
			.Decode((value: string) => Number(value))
			.Encode((value: number) => {
				encodes++
				return `n:${value}`
			})
		const app = new Elysia({
			experimental: { validationPlan }
		})
			.ws('/ws', {
				response: t.Object({ value: Coded }),
				message() {
					return { value: 7 }
				}
			})
			.listen(0)
		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('go')
		expect(JSON.parse((await message).data as string)).toEqual({
			value: 'n:7'
		})
		expect(encodes).toBe(1)

		await wsClosed(ws)
		app.stop()
	})

	it('keeps flag-off and flag-on socket response bytes identical', async () => {
		const roundTrip = async (enabled: boolean) => {
			const app = new Elysia({
				experimental: {
					validationPlan: enabled ? validationPlan : undefined
				}
			})
				.ws('/ws', {
					response: t.Object({ value: t.Number() }),
					message(): any {
						return { value: 7, stripped: true }
					}
				})
				.listen(0)
			const ws = newWebsocket(app.server!)
			await wsOpen(ws)
			const message = wsMessage(ws)
			ws.send('go')
			const data = (await message).data as string
			await wsClosed(ws)
			app.stop()
			return data
		}

		const oracle = await roundTrip(false)
		const candidate = await roundTrip(true)
		expect(candidate).toBe(oracle)
		expect(candidate).toBe('{"value":7}')
	})
})
