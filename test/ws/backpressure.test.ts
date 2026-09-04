import { describe, it, expect } from 'bun:test'
import { handleWSResponse, drainWaiters } from '../../src/ws/route'

// Script send statuses because real socket backpressure is not deterministic.

// readyState: 1 = OPEN, 2 = CLOSING, 3 = CLOSED
class FakeWS {
	sent: unknown[] = []
	readyState = 1
	raw = { data: {} as any }

	// Each entry is the status returned by the next send.
	private script: number[]
	private auto: number

	constructor(script: number[] = [], autoStatus = 1) {
		this.script = script
		this.auto = autoStatus
	}

	send = (data: unknown): number => {
		this.sent.push(data)
		return this.script.length ? this.script.shift()! : this.auto
	}

	// Wake generators waiting for Bun's drain event.
	drain() {
		drainWaiters(this as any)
	}

	// Wake paused generators after closing the socket.
	closeSocket() {
		this.readyState = 3
		drainWaiters(this as any)
	}
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('WebSocket generator backpressure', () => {
	it('streams every yield while send reports available buffer space', async () => {
		const ws = new FakeWS([], 5) // always "5 bytes sent"
		function* gen() {
			yield 'a'
			yield 'b'
			yield 'c'
		}

		await handleWSResponse(ws as any, gen(), [])
		expect(ws.sent).toEqual(['a', 'b', 'c'])
	})

	it('pauses on queued status -1 and resumes without resending', async () => {
		const ws = new FakeWS([-1, 1, 1])

		function* gen() {
			yield 'a'
			yield 'b'
			yield 'c'
		}

		const done = handleWSResponse(ws as any, gen(), [])

		await tick()
		expect(ws.sent).toEqual(['a'])

		ws.drain()
		await done

		expect(ws.sent).toEqual(['a', 'b', 'c'])
	})

	it('pauses on refused status 0 and resends the frame after drain', async () => {
		const ws = new FakeWS([0, 1, 1, 1])

		function* gen() {
			yield 'a'
			yield 'b'
		}

		const done = handleWSResponse(ws as any, gen(), [])

		await tick()
		expect(ws.sent).toEqual(['a']) // first (refused) attempt

		ws.drain()
		await done

		expect(ws.sent).toEqual(['a', 'a', 'b'])
	})

	it('stops iterating when send reports backpressure on a closed socket', async () => {
		const ws = new FakeWS([0], 0) // first send 0, socket then closed
		ws.readyState = 3

		let reached2 = false
		function* gen() {
			yield 'a'
			reached2 = true
			yield 'b'
		}

		await handleWSResponse(ws as any, gen(), [])

		expect(ws.sent).toEqual(['a'])
		expect(reached2).toBe(false)
	})

	it('closes a generator that is paused for drain', async () => {
		const ws = new FakeWS([-1, 1, 1]) // 'a' backpressures → pause

		let ranFinally = false
		function* gen() {
			try {
				yield 'a'
				yield 'b'
				yield 'c'
			} finally {
				ranFinally = true
			}
		}

		const done = handleWSResponse(ws as any, gen(), [])
		await tick()
		expect(ws.sent).toEqual(['a']) // paused

		ws.closeSocket()
		await done

		expect(ws.sent).toEqual(['a']) // nothing more sent on the dead socket
		expect(ranFinally).toBe(true) // generator was cleaned up, not leaked
	})

	it('wakes every paused generator on one drain event', async () => {
		const ws = new FakeWS([], 1)
		ws['script' as any] = [] // reset
		const statuses = [-1, -1, 1, 1, 1, 1]
		let i = 0
		ws.send = (data: unknown): number => {
			ws.sent.push(data)
			return statuses[i++] ?? 1
		}

		function* gen1() {
			yield 'a'
			yield 'b'
		}
		function* gen2() {
			yield 'x'
			yield 'y'
		}

		const d1 = handleWSResponse(ws as any, gen1(), [])
		const d2 = handleWSResponse(ws as any, gen2(), [])

		await tick()
		expect(ws.sent.slice().sort()).toEqual(['a', 'x'])

		ws.drain()
		await Promise.all([d1, d2])

		expect(ws.sent.slice().sort()).toEqual(['a', 'b', 'x', 'y'])
	})

	it('propagates async iterator errors and runs cleanup', async () => {
		const ws = new FakeWS([], 1)

		let ranFinally = false
		async function* gen() {
			try {
				yield 'a'
				throw new Error('boom')
			} finally {
				ranFinally = true
			}
		}

		await expect(handleWSResponse(ws as any, gen(), [])).rejects.toThrow(
			'boom'
		)

		expect(ws.sent).toEqual(['a'])
		expect(ranFinally).toBe(true)
	})

	it('treats status 0 for an empty string as a successful send', async () => {
		const ws = new FakeWS()
		ws.send = ((data: unknown): number => {
			ws.sent.push(data)
			return typeof data === 'string' && data.length === 0
				? 0
				: (data as string).length
		}) as any

		async function* gen() {
			yield 'first'
			yield '' // empty heartbeat — 0 bytes, must not deadlock
			yield 'third'
		}

		await handleWSResponse(ws as any, gen(), [])

		expect(ws.sent).toEqual(['first', '', 'third'])
	})

	it('still resends non-empty frames after accepting an empty status 0', async () => {
		const ws = new FakeWS([0, 1, 0, 1])

		function* gen() {
			yield 'a'
			yield ''
			yield 'b'
		}

		const done = handleWSResponse(ws as any, gen(), [])

		await tick()
		expect(ws.sent).toEqual(['a']) // paused on the non-empty refusal

		ws.drain()
		await done

		expect(ws.sent).toEqual(['a', 'a', '', 'b'])
	})

	it('treats status 0 for an empty binary frame as a successful send', async () => {
		const ws = new FakeWS()
		ws.send = ((data: unknown): number => {
			ws.sent.push(data)
			return (data as ArrayBufferView)?.byteLength ?? 0
		}) as any

		const empty = new Uint8Array(0)
		const full = new Uint8Array([1, 2, 3])
		function* gen() {
			yield full
			yield empty // 0 bytes → 0 status → must not deadlock
			yield full
		}

		await handleWSResponse(ws as any, gen(), [])
		expect(ws.sent).toEqual([full, empty, full])
	})

	it('treats an undefined send status as success', async () => {
		const ws = new FakeWS()
		ws.send = ((data: unknown) => {
			ws.sent.push(data)
			return undefined as any
		}) as any

		function* gen() {
			yield 'a'
			yield 'b'
		}

		await handleWSResponse(ws as any, gen(), [])
		expect(ws.sent).toEqual(['a', 'b'])
	})
})
