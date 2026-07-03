import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

// H32: WS query/params/headers were Check-only — a codec member like
// t.Numeric/t.Date passed Check but never DECODED, so the handler saw the raw
// string while the type claimed a number. The upgrade path now mirrors
// validateMessageBody: when a channel validator hasCodec it runs `From` so the
// DECODED value is what gets copied into ElysiaWS. WHY it matters: a handler
// doing `params.id + 1` would silently string-concat ("41" + 1 = "411")
// instead of adding — a correctness bug the types actively hide.
describe('WebSocket upgrade codec decode (H32)', () => {
	it('params: t.Numeric reaches the handler as a number, not a string', async () => {
		const app = new Elysia()
			.ws('/ws/:id', {
				params: t.Object({ id: t.Numeric() }),
				message({ ws, params }: any) {
					// If decode did not run, `params.id` would be the string
					// "42" and `typeof` would be "string".
					ws.send(`${typeof params.id}:${params.id + 1}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws/42')
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		// decoded → number 42, +1 = 43 (arithmetic, not "421" concat)
		expect((await got).data).toBe('number:43')

		await wsClosed(ws)
		app.stop()
	})

	it('query: t.Numeric decodes before the handler and before Check gating', async () => {
		const app = new Elysia()
			.ws('/ws', {
				query: t.Object({ page: t.Numeric() }),
				message({ ws, query }: any) {
					ws.send(`${typeof query.page}:${query.page * 2}`)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?page=5`
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('number:10')

		await wsClosed(ws)
		app.stop()
	})

	it('headers: t.Numeric decodes into the handler view', async () => {
		const app = new Elysia()
			.ws('/ws', {
				headers: t.Object({ 'x-version': t.Numeric() }),
				message({ ws, headers }: any) {
					ws.send(`${typeof headers['x-version']}:${headers['x-version']}`)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws`,
			{ headers: { 'x-version': '7' } } as any
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('number:7')

		await wsClosed(ws)
		app.stop()
	})

	it('codec validation failure still rejects the upgrade (422)', async () => {
		const app = new Elysia()
			.ws('/ws', {
				query: t.Object({ page: t.Numeric() }),
				message({ ws }: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		// `page=abc` is not a valid number — decode/Check must reject.
		const res = await fetch(
			`http://${app.server!.hostname}:${app.server!.port}/ws?page=abc`,
			{
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-version': '13'
				}
			}
		)

		expect(res.status).toBe(422)
		app.stop()
	})

	it('non-codec channels are unchanged (t.String query round-trips verbatim)', async () => {
		const app = new Elysia()
			.ws('/ws', {
				query: t.Object({ name: t.String() }),
				message({ ws, query }: any) {
					ws.send(`${typeof query.name}:${query.name}`)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?name=jane`
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('string:jane')

		await wsClosed(ws)
		app.stop()
	})

	// Async Standard Schema on WS upgrade channels (query/params/headers) is now
	// SUPPORTED. From() may return a Promise; fetchHandler awaits it before
	// assigning the decoded value into the context channel. The handshake stays
	// promise-free when all channel validators are sync.

	const makeAsyncStandardSchema = (decode?: (v: unknown) => unknown) => ({
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: async (value: unknown) => ({
				value: decode ? decode(value) : value
			})
		}
	})

	const makeSyncStandardSchema = (decode?: (v: unknown) => unknown) => ({
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: (value: unknown) => ({
				value: decode ? decode(value) : value
			})
		}
	})

	it('async Standard Schema on query: valid input opens connection and handler sees decoded value', async () => {
		// The async schema decodes the query by stringifying it; handler echoes
		// it back so we can verify the decoded value reached the handler.
		const app = new Elysia()
			.ws('/ws', {
				query: makeAsyncStandardSchema(
					(v: any) => ({ decoded: v?.page })
				) as any,
				message({ ws, query }: any) {
					ws.send(JSON.stringify(query))
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?page=7`
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		const msg = JSON.parse((await got).data as string)
		// The async schema decoded { page: '7' } → { decoded: '7' }
		expect(msg.decoded).toBe('7')

		await wsClosed(ws)
		app.stop()
	})

	it('async Standard Schema on params: valid input opens connection and handler sees decoded value', async () => {
		const app = new Elysia()
			.ws('/ws/:id', {
				params: makeAsyncStandardSchema(
					(v: any) => ({ id: v?.id + '-decoded' })
				) as any,
				message({ ws, params }: any) {
					ws.send(params.id)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws/hello')
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('hello-decoded')

		await wsClosed(ws)
		app.stop()
	})

	it('async Standard Schema on query: invalid input rejects upgrade with same status as sync path', async () => {
		// Schema rejects (returns issues) for any input where page is missing.
		const rejectingAsyncSchema = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: async (value: unknown) => {
					const v = value as any
					if (!v?.page) return { issues: [{ message: 'page is required' }] }
					return { value }
				}
			}
		}

		const app = new Elysia()
			.ws('/ws', {
				query: rejectingAsyncSchema as any,
				message({ ws }: any) {
					ws.send('reached')
				}
			})
			.listen(0)

		// No ?page — schema rejects
		const res = await fetch(
			`http://${app.server!.hostname}:${app.server!.port}/ws`,
			{
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade',
					'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
					'sec-websocket-version': '13'
				}
			}
		)

		// Must reject with the same status as a sync validation failure
		expect(res.status).toBe(422)
		app.stop()
	})

	it('sync-function-returning-Promise Standard Schema (spec-legal) also works', async () => {
		// A non-async function that returns a Promise is spec-legal per
		// Standard Schema v1 — the validate property is not constrained to
		// AsyncFunction specifically. From() checks `instanceof Promise`, not
		// constructor name.
		const syncReturningPromise = {
			'~standard': {
				version: 1,
				vendor: 'test',
				// regular function, but returns a Promise
				validate: function (value: unknown) {
					return Promise.resolve({ value })
				}
			}
		}

		const app = new Elysia()
			.ws('/ws', {
				query: syncReturningPromise as any,
				message({ ws, query }: any) {
					ws.send(typeof query)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?x=1`
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('object')

		await wsClosed(ws)
		app.stop()
	})

	it('async Standard Schema on body does NOT throw at registration (body path is async-capable)', () => {
		// Body is dispatched via async dispatch paths that await From() —
		// async Standard Schema on body is supported and must not throw.
		expect(() => {
			new Elysia()
				.ws('/ws', {
					body: makeAsyncStandardSchema() as any,
					message({ ws }: any) {
						ws.send('reached')
					}
				})
				.fetch
		}).not.toThrow()
	})

	it('sync Standard Schema on query validates correctly (does not throw, does not reject valid input)', async () => {
		const app = new Elysia()
			.ws('/ws', {
				query: makeSyncStandardSchema() as any,
				message({ ws, query }: any) {
					ws.send(typeof query)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?x=1`
		)
		await wsOpen(ws)
		const got = wsMessage(ws)
		ws.send('ping')
		// query should have been passed through (object), not rejected
		expect((await got).data).toBe('object')

		await wsClosed(ws)
		app.stop()
	})
})
