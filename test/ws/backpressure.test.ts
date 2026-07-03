import { describe, it, expect } from 'bun:test'
import { handleWSResponse, drainWaiters } from '../../src/ws/route'

/**
 * H10 regression — generator streaming must honour ws.send() backpressure.
 *
 * Real backpressure is impractical to reproduce in a unit test, so we drive
 * the exported `handleWSResponse` with a FAKE ws whose send() returns scripted
 * ServerWebSocketSendStatus values (Bun semantics: >0 sent, -1 queued/over
 * limit, 0 refused-not-enqueued) and simulate Bun's `drain` event by calling
 * the exported `drainWaiters`.
 */

// readyState: 1 = OPEN, 2 = CLOSING, 3 = CLOSED
class FakeWS {
	sent: unknown[] = []
	readyState = 1
	raw = { data: {} as any }

	/** each entry scripts the status the NEXT send() returns for that frame */
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

	/** simulate Bun's drain event: buffer emptied, wake paused generators */
	drain() {
		drainWaiters(this as any)
	}

	/** simulate the socket closing while a generator is mid-stream */
	closeSocket() {
		this.readyState = 3
		drainWaiters(this as any)
	}
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('WebSocket generator backpressure (H10)', () => {
	it('healthy buffer (>0): streams every yield with no pause (fast path)', async () => {
		const ws = new FakeWS([], 5) // always "5 bytes sent"
		function* gen() {
			yield 'a'
			yield 'b'
			yield 'c'
		}

		await handleWSResponse(ws as any, gen(), [])
		expect(ws.sent).toEqual(['a', 'b', 'c'])
	})

	it('status -1 (queued): pauses until drain, then resumes IN ORDER without re-sending the queued frame', async () => {
		// frame 'a' → -1 (queued, buffer over limit) → generator must PAUSE.
		// After we fire drain, it resumes and sends 'b','c'. 'a' is NOT re-sent
		// (Bun redelivers a queued frame itself).
		const ws = new FakeWS([-1, 1, 1])

		function* gen() {
			yield 'a'
			yield 'b'
			yield 'c'
		}

		const done = handleWSResponse(ws as any, gen(), [])

		// It must be paused after the first (backpressured) send — only 'a' so far.
		await tick()
		expect(ws.sent).toEqual(['a'])

		// drain fires → resume
		ws.drain()
		await done

		// 'a' sent once (not re-sent), then 'b','c' — order preserved, no loss.
		expect(ws.sent).toEqual(['a', 'b', 'c'])
	})

	it('status 0 on an OPEN socket (refused, not enqueued): pauses then RE-SENDS the same frame after drain — no silent loss', async () => {
		// 'a' is refused (0) → pause. After drain, the SAME 'a' is re-sent and
		// this time succeeds (1). This is the core H10 data-loss guard: a 0 on
		// an open socket must not drop the frame.
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

		// 'a' re-sent after drain, then 'b'. No frame lost.
		expect(ws.sent).toEqual(['a', 'a', 'b'])
	})

	it('status 0/-1 on a CLOSING/CLOSED socket: stops iterating, does not spin or hang', async () => {
		const ws = new FakeWS([0], 0) // first send 0, socket then closed
		ws.readyState = 3

		let reached2 = false
		function* gen() {
			yield 'a'
			reached2 = true
			yield 'b'
		}

		// Must resolve (not hang) even though send() keeps returning 0.
		await handleWSResponse(ws as any, gen(), [])

		// Bailed after the dead-socket send — never pulled the second yield.
		expect(ws.sent).toEqual(['a'])
		expect(reached2).toBe(false)
	})

	it('socket closes WHILE a generator is paused: wakes and stops, no leaked generator', async () => {
		const ws = new FakeWS([-1, 1, 1]) // 'a' backpressures → pause

		let ranFinally = false
		function* gen() {
			try {
				yield 'a'
				yield 'b'
				yield 'c'
			} finally {
				// iter.return() on bail-out must run the producer's cleanup.
				ranFinally = true
			}
		}

		const done = handleWSResponse(ws as any, gen(), [])
		await tick()
		expect(ws.sent).toEqual(['a']) // paused

		// Close mid-pause. The generator wakes, sees readyState 3, and stops.
		ws.closeSocket()
		await done

		expect(ws.sent).toEqual(['a']) // nothing more sent on the dead socket
		expect(ranFinally).toBe(true) // generator was cleaned up, not leaked
	})

	it('multiple generators on one connection: a single drain wakes all of them', async () => {
		const ws = new FakeWS([], 1)
		// script per-frame: gen1 'a' → -1, gen2 'x' → -1, then everything sends
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
		// both paused after their first (backpressured) frame
		expect(ws.sent.slice().sort()).toEqual(['a', 'x'])

		// one drain wakes BOTH generators
		ws.drain()
		await Promise.all([d1, d2])

		expect(ws.sent.slice().sort()).toEqual(['a', 'b', 'x', 'y'])
	})

	it('async-iterator error mid-stream propagates AND cleans up (finally runs)', async () => {
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

		await expect(
			handleWSResponse(ws as any, gen(), [])
		).rejects.toThrow('boom')

		expect(ws.sent).toEqual(['a'])
		expect(ranFinally).toBe(true)
	})

	// H10 deadlock: Bun's `send('')` returns 0 meaning "0 bytes sent", NOT
	// backpressure. An empty yield (common in heartbeat/keep-alive streams) must
	// NOT be mistaken for a full buffer — otherwise the loop parks on a `drain`
	// that never fires (an empty frame added nothing to drain) and every
	// subsequent yield is silently dropped.
	it('empty-string yield returning 0 on a HEALTHY buffer does NOT park — all yields delivered in order', async () => {
		// Every send returns 0 (Bun's "0 bytes sent"): the empty '' AND the
		// non-empty frames are scripted to 0 here to prove the loop keys off the
		// PAYLOAD, not the raw status. A non-empty 0 would normally pause — but
		// this fake never fires drain, so if the empty frame paused we'd hang.
		const ws = new FakeWS()
		ws.send = ((data: unknown): number => {
			ws.sent.push(data)
			// '' → 0 (0 bytes). Non-empty → a real byte count so it never pauses.
			return typeof data === 'string' && data.length === 0
				? 0
				: (data as string).length
		}) as any

		async function* gen() {
			yield 'first'
			yield '' // empty heartbeat — 0 bytes, must not deadlock
			yield 'third'
		}

		// Must resolve, not hang. Before the fix this never resolved.
		await handleWSResponse(ws as any, gen(), [])

		// The empty frame and everything after it are delivered, in order.
		expect(ws.sent).toEqual(['first', '', 'third'])
	})

	// The empty-payload success rule must not disturb the genuine H10 guard: a 0
	// on a NON-empty frame on an open socket is still refusal → pause + re-send.
	it('empty yield success does not weaken the non-empty 0-refusal re-send guard', async () => {
		// 'a' (non-empty) → 0 refused → pause. '' would be 0 too but is empty →
		// never pauses. Sequence: 'a'(0,refused) 'a'(1,resent) ''(0,empty-ok) 'b'(1)
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

		// 'a' re-sent (non-empty refusal guard intact), then the empty '' passes
		// straight through, then 'b'. No frame lost, no hang.
		expect(ws.sent).toEqual(['a', 'a', '', 'b'])
	})

	// Empty binary frame (0-byte Uint8Array) also returns 0 from Bun and must be
	// treated as success, not backpressure.
	it('empty binary yield (0-byte Uint8Array) returning 0 does not park', async () => {
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

	it('undefined send() status (non-Bun adapter) is treated as success — never pauses', async () => {
		const ws = new FakeWS()
		ws.send = ((data: unknown) => {
			ws.sent.push(data)
			return undefined as any
		}) as any

		function* gen() {
			yield 'a'
			yield 'b'
		}

		// Must complete without hanging on a (nonexistent) drain.
		await handleWSResponse(ws as any, gen(), [])
		expect(ws.sent).toEqual(['a', 'b'])
	})
})
