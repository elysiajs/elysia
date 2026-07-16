// A no-op afterResponse hook selects async dispatch without changing output.
// Each case compares it with hook-free synchronous dispatch.

import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsMessage, wsClosed, wsClose } from './utils'

function collectN(ws: WebSocket, n: number): Promise<string[]> {
	return new Promise((resolve) => {
		const got: string[] = []
		ws.onmessage = (e) => {
			got.push(String(e.data))
			if (got.length >= n) resolve(got)
		}
	})
}

const noopAfterResponse = () => undefined

describe('plain string dispatch', () => {
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

describe('codec body dispatch', () => {
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

		expect(ds).toBe(da)

		// Equal failures would also match, so assert the decoded value.
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

describe('error dispatch', () => {
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

describe('generator dispatch', () => {
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

describe('async handler dispatch', () => {
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

describe('validation error dispatch', () => {
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

		const invalid = JSON.stringify({ name: 999 })

		const mSync = wsMessage(wsSync)
		const mAsync = wsMessage(wsAsync)

		wsSync.send(invalid)
		wsAsync.send(invalid)

		const [{ data: ds }, { data: da }] = await Promise.all([mSync, mAsync])

		// Exact TypeBox error wording may change across versions.
		expect(typeof ds).toBe('string')
		expect((ds as string).length).toBeGreaterThan(0)
		expect(ds).toBe(da)

		expect(ds).not.toMatch(/^ok:/)

		await wsClosed(wsSync)
		await wsClosed(wsAsync)
		syncApp.stop()
		asyncApp.stop()
	})
})
