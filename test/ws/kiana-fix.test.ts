import { describe, it, expect } from 'bun:test'
import { Elysia, t, status } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

/**
 * Helper: collect the next N messages from a WS client into an array.
 */
function collectMessages(ws: WebSocket, n: number): Promise<string[]> {
	return new Promise((resolve) => {
		const got: string[] = []
		ws.onmessage = (e) => {
			got.push(String(e.data))
			if (got.length >= n) resolve(got)
		}
	})
}

describe('kiana ws fixes', () => {
	// idx22: a generator's `return <value>` terminates iteration; it is NOT a
	// yield, so it must not be sent as an extra message. `for...of` /
	// `for await` semantics discard the return value — handleWSResponse must
	// match. WHY: leaking the return value sends a trailing message the
	// handler never intended (e.g. `return 'b'` used purely to stop early).
	it('idx22: generator return value is not sent as a trailing message', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message: function* ({ body }: any) {
					yield `a:${body}`
					yield `b:${body}`
					// `return <value>` must terminate WITHOUT being sent.
					return `ret:${body}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		// Race the close frame against an unexpected 3rd message: collect up
		// to 3, but only 2 (the yields) should ever arrive.
		const got: string[] = []
		ws.onmessage = (e) => got.push(String(e.data))
		ws.send('hi')
		await Bun.sleep(30)

		expect(got).toEqual(['a:hi', 'b:hi'])

		await wsClosed(ws)
		app.stop()
	})

	it('idx22: async generator return value is not sent', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message: async function* ({ body }: any) {
					yield `a:${body}`
					return `ret:${body}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got: string[] = []
		ws.onmessage = (e) => got.push(String(e.data))
		ws.send('hi')
		await Bun.sleep(30)

		expect(got).toEqual(['a:hi'])

		await wsClosed(ws)
		app.stop()
	})

	// idx23: a status response with no validator registered for its code must
	// NOT be validated against the default (200) schema. WHY: a 503 body that
	// is legitimately shaped differently from the 200 success body would be
	// rejected by the 200 schema and the client would receive a
	// ValidationError string instead of the intended `{ status, error }`
	// envelope. With only a 200 schema declared, a `status(503, ...)` send
	// has no registered validator and must skip validation.
	it('idx23: status with no registered validator is not validated against 200 schema', async () => {
		const app = new Elysia()
			.ws('/ws', {
				response: {
					200: t.Object({ ok: t.Boolean() })
				},
				message({ body }: any): any {
					// `{ message: 'down' }` does NOT satisfy the 200 schema
					// `{ ok: boolean }`; if the 200 validator is wrongly
					// applied this becomes a ValidationError instead.
					if (body === 'fail')
						return status(503, { message: 'down' })
					return { ok: true }
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const m = wsMessage(ws)
		ws.send('fail')

		const parsed = JSON.parse((await m).data as string)
		expect(parsed).toEqual({ status: 503, error: { message: 'down' } })

		await wsClosed(ws)
		app.stop()
	})

	// idx37: when an error handler returns a value, it is streamed via
	// handleWSResponse — and mapResponse must run on it, exactly like the
	// success path. WHY: the wire payload for an error-handler return must be
	// shaped consistently with the success path (and with HTTP); dropping
	// mapResponse on the error path silently diverges the two.
	it('idx37: error-handler return value passes through mapResponse', async () => {
		const app = new Elysia()
			.error(() => {
				return 'caught'
			})
			.ws('/ws', {
				message() {
					throw new Error('boom')
				},
				mapResponse({ responseValue }: any): any {
					return `mapped-${responseValue}`
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const m = wsMessage(ws)
		ws.send('hi')

		expect((await m).data).toBe('mapped-caught')

		await wsClosed(ws)
		app.stop()
	})

	// idx47: concurrent async ping handlers must each see their own payload
	// across an await — the lifecycle path must isolate per-invocation `body`
	// via Object.create, exactly like the message path. WHY: a shared
	// per-connection instance lets a later ping overwrite an earlier
	// in-flight handler's `body`, so the first handler resumes reading the
	// wrong payload.
	it('idx47: concurrent ping handlers each keep their own body across an await', async () => {
		const seen: { before: string; after: string }[] = []

		const app = new Elysia()
			.ws('/ws', {
				async ping(ws: any) {
					// Read the per-invocation `body` off the ws view, NOT a
					// destructured local — the destructured value is captured
					// per-call and could not detect a shared-instance clobber.
					const before = String(ws.body)
					// 'slow' finishes AFTER 'fast', so a shared instance would
					// let 'fast' overwrite 'slow's body before this resumes.
					await Bun.sleep(before === 'slow' ? 40 : 1)
					seen.push({ before, after: String(ws.body) })
				},
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		;(ws as any).ping('slow')
		;(ws as any).ping('fast')

		await Bun.sleep(120)

		expect(seen.length).toBe(2)
		// each ping's body must be consistent before & after the await
		for (const r of seen) expect(r.after).toBe(r.before)
		// both distinct payloads must survive (not both clobbered to one)
		expect(seen.map((r) => r.before).sort()).toEqual(['fast', 'slow'])

		await wsClosed(ws)
		app.stop()
	})
})
