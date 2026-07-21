import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { newWebsocket, wsOpen, wsClosed, wsMessage, wsUpgrade } from './utils'

describe('WebSocket upgrade schema decoding', () => {
	it('decodes Numeric route parameters before the handler', async () => {
		const app = new Elysia()
			.ws('/ws/:id', {
				params: t.Object({ id: t.Numeric() }),
				message({ ws, params }: any) {
					ws.send(`${typeof params.id}:${params.id + 1}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws/42')
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('number:43')

		await wsClosed(ws)
		app.stop()
	})

	it('decodes Numeric query parameters before the handler', async () => {
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

	it('decodes Numeric headers before the handler', async () => {
		const app = new Elysia()
			.ws('/ws', {
				headers: t.Object({ 'x-version': t.Numeric() }),
				message({ ws, headers }: any) {
					ws.send(
						`${typeof headers['x-version']}:${headers['x-version']}`
					)
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

	it('rejects invalid codec values during upgrade', async () => {
		const app = new Elysia()
			.ws('/ws', {
				query: t.Object({ page: t.Numeric() }),
				message({ ws }: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const res = await wsUpgrade(app.server!, '/ws?page=abc')

		expect(res.status).toBe(422)
		app.stop()
	})

	it('passes String query parameters through unchanged', async () => {
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

	// WebSocket upgrade schemas may validate and decode asynchronously.

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

	it('awaits async Standard Schema decoding for query parameters', async () => {
		const app = new Elysia()
			.ws('/ws', {
				query: makeAsyncStandardSchema((v: any) => ({
					decoded: v?.page
				})) as any,
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
		expect(msg.decoded).toBe('7')

		await wsClosed(ws)
		app.stop()
	})

	it('awaits async Standard Schema decoding for route parameters', async () => {
		const app = new Elysia()
			.ws('/ws/:id', {
				params: makeAsyncStandardSchema((v: any) => ({
					id: v?.id + '-decoded'
				})) as any,
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

	it('rejects invalid async Standard Schema query parameters', async () => {
		const rejectingAsyncSchema = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: async (value: unknown) => {
					const v = value as any
					if (!v?.page)
						return { issues: [{ message: 'page is required' }] }
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

		const res = await wsUpgrade(app.server!)

		expect(res.status).toBe(422)
		app.stop()
	})

	it('rejects a Promise returned by a non-async Standard Schema validator', async () => {
		// Promise-returning validators must declare async so the route awaits them.
		const syncReturningPromise = {
			'~standard': {
				version: 1,
				vendor: 'test',
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

		const res = await wsUpgrade(app.server!, '/ws?x=1')

		expect(res.status).toBe(500)
		await expect(res.text()).resolves.toContain(
			'asynchronous Standard Schema'
		)
		app.stop()
	})

	it('accepts async Standard Schema validators for message bodies', () => {
		expect(() => {
			new Elysia().ws('/ws', {
				body: makeAsyncStandardSchema() as any,
				message({ ws }: any) {
					ws.send('reached')
				}
			}).fetch
		}).not.toThrow()
	})

	it('accepts synchronous Standard Schema validators for query parameters', async () => {
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
		expect((await got).data).toBe('object')

		await wsClosed(ws)
		app.stop()
	})
})
