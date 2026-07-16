import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { file } from '../../src/universal/file'

// Why this matters (fetch-universal-1): on the Node (non-Bun) branch,
// `new ElysiaFile(path)` used to eagerly `createReadStream(path)` (and `stat`)
// in the constructor. A missing/unreadable path makes the ReadStream emit an
// unhandled 'error' event, which Node re-throws on the NEXT TICK — OUTSIDE the
// request try/catch — terminating the whole server process (exit 1). One bad
// `file('missing')` reference could take down a live Node server and every
// in-flight/future request. The fix attaches a no-op 'error' sink to the stream
// and `.catch()`es the stat promise so a missing file can no longer crash the
// process; the real ENOENT still reaches the consumer that reads the body/stats.
//
// NOTE: this suite runs under Bun (CI is Bun-only), where `file()` uses the
// lazy `Bun.file` path and never eager-opens/crashes. So these Bun assertions
// only pin that construction + app.handle stay non-throwing and the ENOENT is
// still deferred to body-read. The Node no-crash guarantee itself is verified
// OUT-OF-BAND: build `src/index.ts` with `bun build --target=node` and run a
// plain-`node` server that serves health -> missing-file -> health; before the
// fix HEALTH_2 never responds (process exits 1), after the fix the server
// survives (SERVER_SURVIVED, exit 0).
describe('file() on a missing path', () => {
	const MISSING = '/tmp/__elysia_does_not_exist_' + Date.now() + '.bin'

	it('does not throw at construction for a missing path', () => {
		expect(() => file(MISSING)).not.toThrow()
	})

	it('app.handle resolves without throwing when a handler returns a missing file', async () => {
		const app = new Elysia().get('/missing', () => file(MISSING))

		// The framework-level guarantee: handling the request never throws
		// synchronously and the process is not torn down at construction time.
		const res = await app.handle(new Request('http://localhost/missing'))
		expect(res).toBeInstanceOf(Response)
	})

	it('surfaces the ENOENT only when the body stream is read', async () => {
		const app = new Elysia().get('/missing', () => file(MISSING))

		const res = await app.handle(new Request('http://localhost/missing'))

		// The error is deferred to body-read (not swallowed): reading the body
		// of the missing file rejects rather than silently returning empty.
		let threw = false
		try {
			await res.arrayBuffer()
		} catch {
			threw = true
		}

		expect(threw).toBe(true)
	})
})
