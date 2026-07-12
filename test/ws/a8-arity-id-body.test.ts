import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

// A8 (Train N-correctness):
//   1. Event args are the public positional contract — arity (`fn.length`)
//      must NOT gate argument delivery. Default-param and rest-param message
//      handlers still receive the real body positionally.
//   2. Every connection gets a unique, stable, non-empty id (seeded `undefined`
//      so the getter mints one; previously seeded `''` → all ids collided).
//   3. The per-frame `ws.body` view is allocated only when the handler may
//      observe it, with conservative fallback; correctness of `ws.body` is
//      preserved for touched AND unanalyzable handlers.

describe('WS A8 — positional body delivery (point 1)', () => {
	it('delivers body positionally to a default-param handler (fails on old arity gate)', async () => {
		// `.length` is 1 here (default param not counted) — the old
		// `messageTakesBody = fn.length >= 2` gate would call `fn(ws)` and the
		// handler would see the default `'DEFAULT'` instead of the real body.
		const app = new Elysia()
			.ws('/ws', {
				message(ws, msg = 'DEFAULT') {
					ws.send(String(msg))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('real-body')

		const { data } = await message
		expect(data).toBe('real-body')

		await wsClosed(ws)
		app.stop()
	})

	it('delivers body positionally to a rest-param handler (fails on old arity gate)', async () => {
		// `.length` is 1 (rest param not counted) — old gate would call `fn(ws)`
		// and `args` would be empty.
		const app = new Elysia()
			.ws('/ws', {
				message(ws, ...args: unknown[]) {
					ws.send(String(args[0]))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('rest-body')

		const { data } = await message
		expect(data).toBe('rest-body')

		await wsClosed(ws)
		app.stop()
	})
})

describe('WS A8 — connection id (point 2)', () => {
	it('gives two concurrent connections distinct non-empty ids (fails on old id: "")', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.send(ws.id)
				}
			})
			.listen(0)

		const a = newWebsocket(app.server!)
		const b = newWebsocket(app.server!)
		await wsOpen(a)
		await wsOpen(b)

		const aMsg = wsMessage(a)
		const bMsg = wsMessage(b)
		a.send('id?')
		b.send('id?')

		const aId = (await aMsg).data as string
		const bId = (await bMsg).data as string

		expect(aId).toBeTruthy()
		expect(bId).toBeTruthy()
		expect(aId).not.toBe('')
		expect(bId).not.toBe('')
		expect(aId).not.toBe(bId)

		await wsClosed(a)
		await wsClosed(b)
		app.stop()
	})

	it('keeps the id stable within a connection across messages', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.send(ws.id)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const first = wsMessage(ws)
		ws.send('1')
		const firstId = (await first).data as string

		const second = wsMessage(ws)
		ws.send('2')
		const secondId = (await second).data as string

		expect(firstId).toBeTruthy()
		expect(firstId).toBe(secondId)

		await wsClosed(ws)
		app.stop()
	})
})

describe('WS A8 — ws.body observability (point 3)', () => {
	it('untouched-body handler works (allocation skipped path)', async () => {
		const app = new Elysia()
			.ws('/ws', {
				// Never references `.body`; body still delivered positionally.
				message(ws, message) {
					ws.send(`echo:${message}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('hi')

		expect((await message).data).toBe('echo:hi')

		await wsClosed(ws)
		app.stop()
	})

	it('statically-touched handler observes correct ws.body', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.send(`body:${ws.body}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('touched')

		expect((await message).data).toBe('body:touched')

		await wsClosed(ws)
		app.stop()
	})

	it('unanalyzable (bound) handler observes correct ws.body (conservative fallback)', async () => {
		// A bound function's source is `function () { [native code] }` — the
		// analysis cannot see whether it touches `.body`, so it must
		// conservatively allocate. The bound impl reads `ws.body`.
		function impl(this: unknown, ws: any) {
			ws.send(`bound-body:${ws.body}`)
		}
		const bound = impl.bind(null)

		const app = new Elysia()
			.ws('/ws', {
				message: bound as any
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('via-bound')

		expect((await message).data).toBe('bound-body:via-bound')

		await wsClosed(ws)
		app.stop()
	})

	it('handler that forwards ws to another function observes ws.body (escape → allocate)', async () => {
		const read = (w: any) => w.body
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					// `ws` escapes into `read`; source has no literal `.body`,
					// so the analysis must fall back to allocating.
					ws.send(`fwd:${read(ws)}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('forwarded')

		expect((await message).data).toBe('fwd:forwarded')

		await wsClosed(ws)
		app.stop()
	})

	it('schema route keeps parsing/observing body even when handler ignores it', async () => {
		const { t } = await import('../../src')
		const app = new Elysia()
			.ws('/ws', {
				body: t.Object({ n: t.Number() }),
				// Ignores body positionally, but validation must still run and
				// `ws.body` remain the validated object.
				message(ws) {
					ws.send(JSON.stringify(ws.body))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send(JSON.stringify({ n: 5 }))

		expect((await message).data).toBe(JSON.stringify({ n: 5 }))

		await wsClosed(ws)
		app.stop()
	})

	it('lifecycle hooks observe ws.body when the message handler does not', async () => {
		const seen: string[] = []
		const app = new Elysia()
			.ws('/ws', {
				message() {
					return 'reply'
				},
				mapResponse(ws) {
					seen.push(`map:${ws.body}`)
				},
				afterHandle(ws) {
					seen.push(`afterHandle:${ws.body}`)
				},
				afterResponse(ws) {
					seen.push(`afterResponse:${ws.body}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('hook-body')
		await message

		expect(seen).toEqual([
			'map:hook-body',
			'afterHandle:hook-body',
			'afterResponse:hook-body'
		])

		await wsClosed(ws)
		app.stop()
	})
})
