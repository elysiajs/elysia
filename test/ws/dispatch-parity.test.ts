/**
 * Invariant: sync and async message-dispatch pipelines must produce
 * byte-identical wire output.
 *
 * src/ws/route.ts computes `syncDispatchEligible` (line ~434):
 *   transforms.length === 0 &&
 *   messageBeforeHandles.length === 0 &&
 *   afterHandles.length === 0 &&
 *   afterResponses.length === 0 &&
 *   mapResponses.length === 0
 *
 * When true → dispatchMessageSync; otherwise → dispatchMessage.
 * These two functions are hand-rolled and must stay in semantic
 * lockstep.  This suite runs every scenario through BOTH a
 * sync-eligible route (bare handler) and a forced-async route
 * (an afterResponse hook that is semantically transparent: it does
 * nothing, returns undefined, introduces no observable side-effects
 * but flips syncDispatchEligible to false).
 *
 * For each scenario the wire output (or close/error frame) from both
 * routes must be identical.
 */

import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import {
	newWebsocket,
	wsOpen,
	wsMessage,
	wsClosed,
	wsClose
} from './utils'

// ---------------------------------------------------------------------------
// Helper: collect N frames from an open WebSocket
// ---------------------------------------------------------------------------
function collectN(ws: WebSocket, n: number): Promise<string[]> {
	return new Promise((resolve) => {
		const got: string[] = []
		ws.onmessage = (e) => {
			got.push(String(e.data))
			if (got.length >= n) resolve(got)
		}
	})
}

// ---------------------------------------------------------------------------
// no-op afterResponse — flips syncDispatchEligible but changes nothing else
// ---------------------------------------------------------------------------
const noopAfterResponse = () => undefined

// ---------------------------------------------------------------------------
// Scenario 1 — plain string echo
// Invariant: both pipelines echo the raw frame byte-for-byte.
// ---------------------------------------------------------------------------
describe('dispatch-parity: scenario 1 — plain string echo', () => {
	it('sync and async pipelines echo identical strings', async () => {
		const syncApp = new Elysia()
			.ws('/ws', {
				message(ws, message) {
					ws.send(message as string)
				}
			})
			.listen(0)

		const asyncApp = new Elysia()
			.ws('/ws', {
				afterResponse: noopAfterResponse,
				message(ws, message) {
					ws.send(message as string)
				}
			})
			.listen(0)

		const wsSync = newWebsocket(syncApp.server!)
		const wsAsync = newWebsocket(asyncApp.server!)
		await wsOpen(wsSync)
		await wsOpen(wsAsync)

		const mSync = wsMessage(wsSync)
		const mAsync = wsMessage(wsAsync)

		wsSync.send('hello')
		wsAsync.send('hello')

		const [{ data: ds }, { data: da }] = await Promise.all([mSync, mAsync])

		expect(ds).toBe(da)

		await wsClosed(wsSync)
		await wsClosed(wsAsync)
		syncApp.stop()
		asyncApp.stop()
	})
})

// ---------------------------------------------------------------------------
// Scenario 2 — body schema with codec (t.Date + t.Numeric)
// Invariant: both pipelines decode codec fields identically before the
// handler runs.  The handler echoes decoded values; both wire responses
// must be byte-identical JSON.
// ---------------------------------------------------------------------------
describe('dispatch-parity: scenario 2 — body schema with codec', () => {
	it('sync and async pipelines decode codec fields identically', async () => {
		const makeApp = (forceAsync: boolean) =>
			new Elysia()
				.ws('/ws', {
					body: t.Object({ when: t.Date(), n: t.Numeric() }),
					...(forceAsync ? { afterResponse: noopAfterResponse } : {}),
					message(ws, body: any) {
						ws.send(
							JSON.stringify({
								whenIsDate: body.when instanceof Date,
								iso:
									body.when instanceof Date
										? body.when.toISOString()
										: null,
								n: body.n,
								nType: typeof body.n
							})
						)
					}
				})
				.listen(0)

		const syncApp = makeApp(false)
		const asyncApp = makeApp(true)

		const wsSync = newWebsocket(syncApp.server!)
		const wsAsync = newWebsocket(asyncApp.server!)
		await wsOpen(wsSync)
		await wsOpen(wsAsync)

		const payload = JSON.stringify({
			when: '2020-01-01T00:00:00.000Z',
			n: '42'
		})

		const mSync = wsMessage(wsSync)
		const mAsync = wsMessage(wsAsync)

		wsSync.send(payload)
		wsAsync.send(payload)

		const [{ data: ds }, { data: da }] = await Promise.all([mSync, mAsync])

		// Both must produce identical wire JSON.
		expect(ds).toBe(da)

		// And the common decoded value must be correct.
		const parsed = JSON.parse(ds as string)
		expect(parsed.whenIsDate).toBe(true)
		expect(parsed.n).toBe(42)
		expect(parsed.nType).toBe('number')

		await wsClosed(wsSync)
		await wsClosed(wsAsync)
		syncApp.stop()
		asyncApp.stop()
	})
})

// ---------------------------------------------------------------------------
// Scenario 3 — throwing handler
// Invariant: both pipelines route the throw through the error hook and
// send an identical error frame.  The connection must remain open.
// ---------------------------------------------------------------------------
describe('dispatch-parity: scenario 3 — throwing handler', () => {
	it('sync and async pipelines produce identical error frames on throw', async () => {
		const makeApp = (forceAsync: boolean) =>
			new Elysia()
				.ws('/ws', {
					...(forceAsync ? { afterResponse: noopAfterResponse } : {}),
					error() {
						return 'caught-error'
					},
					message() {
						throw new Error('boom')
					}
				})
				.listen(0)

		const syncApp = makeApp(false)
		const asyncApp = makeApp(true)

		const wsSync = newWebsocket(syncApp.server!)
		const wsAsync = newWebsocket(asyncApp.server!)
		await wsOpen(wsSync)
		await wsOpen(wsAsync)

		const mSync = wsMessage(wsSync)
		const mAsync = wsMessage(wsAsync)

		wsSync.send('trigger')
		wsAsync.send('trigger')

		const [{ data: ds }, { data: da }] = await Promise.all([mSync, mAsync])

		expect(ds).toBe(da)
		expect(ds).toBe('caught-error')

		await wsClosed(wsSync)
		await wsClosed(wsAsync)
		syncApp.stop()
		asyncApp.stop()
	})
})

// ---------------------------------------------------------------------------
// Scenario 4 — generator handler (multiple yields)
// Invariant: both pipelines stream identical yield sequences.
// ---------------------------------------------------------------------------
describe('dispatch-parity: scenario 4 — generator handler', () => {
	it('sync and async pipelines stream identical generator yield sequences', async () => {
		const makeApp = (forceAsync: boolean) =>
			new Elysia()
				.ws('/ws', {
					...(forceAsync ? { afterResponse: noopAfterResponse } : {}),
					// @ts-ignore generator return type accepted at runtime
					message: function* (_ws: any, body: any) {
						yield `a:${body}`
						yield `b:${body}`
						yield `c:${body}`
					}
				})
				.listen(0)

		const syncApp = makeApp(false)
		const asyncApp = makeApp(true)

		const wsSync = newWebsocket(syncApp.server!)
		const wsAsync = newWebsocket(asyncApp.server!)
		await wsOpen(wsSync)
		await wsOpen(wsAsync)

		const framesSync = collectN(wsSync, 3)
		const framesAsync = collectN(wsAsync, 3)

		wsSync.send('x')
		wsAsync.send('x')

		const [gotSync, gotAsync] = await Promise.all([framesSync, framesAsync])

		expect(gotSync).toEqual(gotAsync)
		expect(gotSync).toEqual(['a:x', 'b:x', 'c:x'])

		await wsClosed(wsSync)
		await wsClosed(wsAsync)
		syncApp.stop()
		asyncApp.stop()
	})
})

// ---------------------------------------------------------------------------
// Scenario 5 — handler returning a Promise
// Invariant: both pipelines await the Promise and send the resolved
// value as an identical frame.
// ---------------------------------------------------------------------------
describe('dispatch-parity: scenario 5 — handler returning a Promise', () => {
	it('sync and async pipelines await and send identical resolved values', async () => {
		const makeApp = (forceAsync: boolean) =>
			new Elysia()
				.ws('/ws', {
					...(forceAsync ? { afterResponse: noopAfterResponse } : {}),
					async message(_ws: any, body: any) {
						await Bun.sleep(5)
						return `async-${body}`
					}
				})
				.listen(0)

		const syncApp = makeApp(false)
		const asyncApp = makeApp(true)

		const wsSync = newWebsocket(syncApp.server!)
		const wsAsync = newWebsocket(asyncApp.server!)
		await wsOpen(wsSync)
		await wsOpen(wsAsync)

		const mSync = wsMessage(wsSync)
		const mAsync = wsMessage(wsAsync)

		wsSync.send('hello')
		wsAsync.send('hello')

		const [{ data: ds }, { data: da }] = await Promise.all([mSync, mAsync])

		expect(ds).toBe(da)
		expect(ds).toBe('async-hello')

		await wsClosed(wsSync)
		await wsClosed(wsAsync)
		syncApp.stop()
		asyncApp.stop()
	})
})

// ---------------------------------------------------------------------------
// Scenario 6 — validation failure (invalid body)
// Invariant: both pipelines send an identical validation-error frame
// for invalid body (no crash, no close frame for validation errors).
// ---------------------------------------------------------------------------
describe('dispatch-parity: scenario 6 — validation failure', () => {
	it('sync and async pipelines send identical frames on body validation failure', async () => {
		const makeApp = (forceAsync: boolean) =>
			new Elysia()
				.ws('/ws', {
					body: t.Object({ name: t.String() }),
					...(forceAsync ? { afterResponse: noopAfterResponse } : {}),
					message(ws: any, body: any) {
						ws.send(`ok:${body.name}`)
					}
				})
				.listen(0)

		const syncApp = makeApp(false)
		const asyncApp = makeApp(true)

		const wsSync = newWebsocket(syncApp.server!)
		const wsAsync = newWebsocket(asyncApp.server!)
		await wsOpen(wsSync)
		await wsOpen(wsAsync)

		// Send an integer where a string is expected — triggers validation error.
		const invalid = JSON.stringify({ name: 999 })

		const mSync = wsMessage(wsSync)
		const mAsync = wsMessage(wsAsync)

		wsSync.send(invalid)
		wsAsync.send(invalid)

		const [{ data: ds }, { data: da }] = await Promise.all([mSync, mAsync])

		// Both must send some non-empty error message — exact wording is
		// owned by TypeBox and may change across versions.
		expect(typeof ds).toBe('string')
		expect((ds as string).length).toBeGreaterThan(0)
		// Core invariant: identical wire output on both paths.
		expect(ds).toBe(da)

		// The handler must NOT have run — no 'ok:' prefix.
		expect(ds).not.toMatch(/^ok:/)

		await wsClosed(wsSync)
		await wsClosed(wsAsync)
		syncApp.stop()
		asyncApp.stop()
	})
})
