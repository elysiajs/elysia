import { describe, it, expect } from 'bun:test'
import { ElysiaWS } from '../../src/ws'

// Directly-constructed `ElysiaWS` instances never populate `raw.data.elysia`,
// so these hit the `?? this` fallback in the send/ping/pong/publish/close
// getters, matching the pattern already used for the raw-passthrough getters.
function createRaw(data: any = {}) {
	const calls: Record<string, unknown[]> = {}
	const record =
		(name: string) =>
		(...args: unknown[]) => {
			calls[name] = args
			return `${name}-status` as any
		}

	const raw: any = {
		data,
		readyState: 1,
		subscriptions: ['a', 'b'],
		send: record('send'),
		ping: record('ping'),
		pong: record('pong')
	}

	return { raw, calls }
}

describe('ElysiaWS ping', () => {
	it('forwards undefined data straight to raw.ping', () => {
		const { raw, calls } = createRaw()
		const ws = new ElysiaWS(raw)

		const result = ws.ping() as unknown

		expect(calls.ping).toEqual([])
		expect(result).toBe('ping-status')
	})

	it('forwards binary data untouched', () => {
		const { raw, calls } = createRaw()
		const ws = new ElysiaWS(raw)
		const bytes = new Uint8Array([1, 2, 3])

		ws.ping(bytes as any)

		expect(calls.ping[0]).toBe(bytes)
	})

	it('JSON-stringifies object data', () => {
		const { raw, calls } = createRaw()
		const ws = new ElysiaWS(raw)

		ws.ping({ hello: 'world' } as any)

		expect(calls.ping[0]).toBe(JSON.stringify({ hello: 'world' }))
	})

	it('sends the validation error instead of pinging on invalid data', () => {
		const { raw, calls } = createRaw({
			validator: {},
			defaultValidator: {
				Check: () => false,
				Errors: () => [{ message: 'bad' }]
			}
		})
		const ws = new ElysiaWS(raw)

		ws.ping({ bad: true } as any)

		expect(calls.ping).toBeUndefined()
		expect(typeof calls.send[0]).toBe('string')
	})

	it('memoizes the getter onto the instance', () => {
		const { raw } = createRaw()
		const ws = new ElysiaWS(raw)

		const first = ws.ping
		expect(ws.ping).toBe(first)
	})
})

describe('ElysiaWS pong', () => {
	it('forwards undefined data straight to raw.pong', () => {
		const { raw, calls } = createRaw()
		const ws = new ElysiaWS(raw)

		const result = ws.pong() as unknown

		expect(calls.pong).toEqual([])
		expect(result).toBe('pong-status')
	})

	it('forwards binary data untouched', () => {
		const { raw, calls } = createRaw()
		const ws = new ElysiaWS(raw)
		const bytes = new Uint8Array([4, 5, 6])

		ws.pong(bytes as any)

		expect(calls.pong[0]).toBe(bytes)
	})

	it('JSON-stringifies object data', () => {
		const { raw, calls } = createRaw()
		const ws = new ElysiaWS(raw)

		ws.pong({ hello: 'world' } as any)

		expect(calls.pong[0]).toBe(JSON.stringify({ hello: 'world' }))
	})

	it('sends the validation error instead of ponging on invalid data', () => {
		const { raw, calls } = createRaw({
			validator: {},
			defaultValidator: {
				Check: () => false,
				Errors: () => [{ message: 'bad' }]
			}
		})
		const ws = new ElysiaWS(raw)

		ws.pong({ bad: true } as any)

		expect(calls.pong).toBeUndefined()
		expect(typeof calls.send[0]).toBe('string')
	})

	it('memoizes the getter onto the instance', () => {
		const { raw } = createRaw()
		const ws = new ElysiaWS(raw)

		const first = ws.pong
		expect(ws.pong).toBe(first)
	})
})

describe('ElysiaWS send (unwrapped instance)', () => {
	it('reaches raw.send through the `?? this` fallback', () => {
		const { raw, calls } = createRaw()
		const ws = new ElysiaWS(raw)

		ws.send('hi')

		expect(calls.send[0]).toBe('hi')
	})
})

describe('ElysiaWS property accessors', () => {
	it('readyState passes through to raw.readyState', () => {
		const { raw } = createRaw()
		const ws = new ElysiaWS(raw)

		expect(ws.readyState).toBe(raw.readyState)
	})

	it('subscriptions passes through to raw.subscriptions', () => {
		const { raw } = createRaw()
		const ws = new ElysiaWS(raw)

		expect(ws.subscriptions).toBe(raw.subscriptions)
	})

	it('data passes through to raw.data', () => {
		const { raw } = createRaw()
		const ws = new ElysiaWS(raw)

		expect(ws.data).toBe(raw.data)
	})

	it('id is lazily generated once and memoized on raw.data', () => {
		const { raw } = createRaw()
		const ws = new ElysiaWS(raw)

		expect(raw.data.id).toBeUndefined()

		const id = ws.id

		expect(id).toBeTruthy()
		expect(raw.data.id).toBe(id)
		// second read must not regenerate the id
		expect(ws.id).toBe(id)
	})

	it('keeps a pre-existing id instead of regenerating one', () => {
		const { raw } = createRaw({ id: 'preset-id' })
		const ws = new ElysiaWS(raw)

		expect(ws.id).toBe('preset-id')
	})
})
