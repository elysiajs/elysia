import { describe, it, expect } from 'bun:test'
import { Elysia, t, ValidationError } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

describe('WebSocket non-body schemas', () => {
	it('query: success — typed query is accessible inside handler', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				query: t.Object({ name: t.String() }),
				message({ ws, query }: any) {
					ws.send(`hi-${query.name}`)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?name=jane`
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('hi-jane')

		await wsClosed(ws)
		app.stop()
	})

	it('query: failure — upgrade is rejected with HTTP 422', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				query: t.Object({ name: t.String() }),
				message({ ws }: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const upgradeResponse = await fetch(
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

		expect(upgradeResponse.status).toBe(422)

		app.stop()
	})

	it('params: dynamic path param validated at upgrade', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws/:id', {
				params: t.Object({ id: t.String() }),
				message({ ws, params }: any) {
					ws.send(`id=${params.id}`)
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws/42')
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('id=42')

		await wsClosed(ws)
		app.stop()
	})

	it('headers: success — typed headers usable in handler', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				headers: t.Object({
					'x-token': t.String()
				}),
				message({ ws, headers }: any) {
					ws.send(`token=${headers['x-token']}`)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws`,
			{
				// Bun's WebSocket constructor accepts a `headers` field via
				// its options arg (BunWebSocketOptions). Used at handshake.
				headers: { 'x-token': 'abc' }
			} as any
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('token=abc')

		await wsClosed(ws)
		app.stop()
	})

	it('headers: failure — upgrade rejected when required header missing', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				headers: t.Object({
					'x-token': t.String()
				}),
				message({ ws }: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const upgradeResponse = await fetch(
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

		expect(upgradeResponse.status).toBe(422)

		app.stop()
	})

	it('upgrade-time validation errors route through `.error()`', async () => {
		let seenIsValidation = false
		let seenOn: string | undefined

		const app = new Elysia()
			.error(({ error }: any) => {
				seenIsValidation = error instanceof ValidationError
				seenOn = (error as any)?.type
				return new Response('caught:' + (error as any)?.type, {
					status: 418
				})
			})
			.use(websocket()).ws('/ws', {
				query: t.Object({ name: t.String() }),
				message({ ws }: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const response = await fetch(
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

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('caught:query')
		expect(seenIsValidation).toBe(true)
		expect(seenOn).toBe('query')

		app.stop()
	})

	it('query: Standard Schema (zod) success and failure both honored', async () => {
		const z = await import('zod')
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				query: z.object({ name: z.string() }),
				message({ ws, query }: any) {
					ws.send(`hi-${query.name}`)
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?name=zoe`
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect((await got).data).toBe('hi-zoe')

		await wsClosed(ws)

		const upgradeResponse = await fetch(
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
		expect(upgradeResponse.status).toBe(422)

		app.stop()
	})

	it('query: preserves duplicate values when the schema expects an array', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				query: t.Object({ id: t.Array(t.String()) }),
				message({ ws, query }: any) {
					ws.send(JSON.stringify(query))
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws?id=a&id=b`
		)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect(JSON.parse((await got).data as string)).toEqual({
			id: ['a', 'b']
		})

		await wsClosed(ws)
		app.stop()
	})

	it('query: passes an empty object when the upgrade has no query string', async () => {
		const app = new Elysia()
			.use(websocket()).ws('/ws', {
				query: t.Object({ name: t.Optional(t.String()) }),
				message({ ws, query }: any) {
					ws.send(JSON.stringify(query))
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const got = wsMessage(ws)
		ws.send('ping')
		expect(JSON.parse((await got).data as string)).toEqual({})

		await wsClosed(ws)
		app.stop()
	})
})

// WS request channels validate through the same `From` entry HTTP uses:
// a schema default or an optional root is honoured, not refused with a 422
describe('WebSocket request schemas apply defaults like HTTP', () => {
	const echo = async (app: any, path: string, payload = 'ping') => {
		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}${path}`
		)
		await wsOpen(ws)
		const got = wsMessage(ws)
		ws.send(payload)
		const data = (await got).data
		await wsClosed(ws)
		return data
	}

	it('query: a default fills a missing key on HTTP and on the upgrade', async () => {
		const query = t.Object({ name: t.String({ default: 'anon' }) })
		const app = new Elysia()
			.use(websocket())
			.get('/h', { query }, ({ query }) => query.name)
			.ws('/ws', {
				query,
				message({ ws, query }: any) {
					ws.send(query.name)
				}
			})
			.listen(0)

		const http = await app.handle(new Request('http://localhost/h'))
		expect(await http.text()).toBe('anon')
		expect(await echo(app, '/ws')).toBe('anon')

		app.stop()
	})

	it('headers: a default fills a missing header at upgrade', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				headers: t.Object({
					'x-tenant': t.String({ default: 'public' })
				}),
				message({ ws, headers }: any) {
					ws.send(headers['x-tenant'])
				}
			})
			.listen(0)

		expect(await echo(app, '/ws')).toBe('public')

		app.stop()
	})

	it('params: a default fills a key the path does not carry', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws/:id', {
				params: t.Object({
					id: t.String(),
					sort: t.String({ default: 'asc' })
				}),
				message({ ws, params }: any) {
					ws.send(`${params.id}:${params.sort}`)
				}
			})
			.listen(0)

		expect(await echo(app, '/ws/42')).toBe('42:asc')

		app.stop()
	})

	it('cookie: a default fills a missing cookie at upgrade', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				cookie: t.Cookie({ theme: t.String({ default: 'light' }) }),
				message({ ws, cookie }: any) {
					ws.send(cookie.theme.value)
				}
			})
			.listen(0)

		expect(await echo(app, '/ws')).toBe('light')

		app.stop()
	})

	it('body: a default fills a missing key of a message', async () => {
		const body = t.Object({ n: t.Number({ default: 7 }) })
		const app = new Elysia()
			.use(websocket())
			.post('/h', { body }, ({ body }) => String(body.n))
			.ws('/ws', {
				body,
				message(ws, body: any) {
					ws.send(String(body.n))
				}
			})
			.listen(0)

		const http = await app.handle(
			new Request('http://localhost/h', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			})
		)
		expect(await http.text()).toBe('7')
		expect(await echo(app, '/ws', '{}')).toBe('7')

		app.stop()
	})

	it('query: an optional root accepts an upgrade without a query string', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				query: t.Optional(t.Object({ name: t.String() })),
				message({ ws, query }: any) {
					ws.send(JSON.stringify(query))
				}
			})
			.listen(0)

		expect(await echo(app, '/ws')).toBe('{}')

		app.stop()
	})

	it('query: still strips an undeclared key under normalize', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				query: t.Object({ name: t.String({ default: 'anon' }) }),
				message({ ws, query }: any) {
					ws.send(JSON.stringify(query))
				}
			})
			.listen(0)

		expect(await echo(app, '/ws?name=jane&extra=1')).toBe(
			'{"name":"jane"}'
		)

		app.stop()
	})

	it('query: a default on one key does not rescue another missing key', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				query: t.Object({
					name: t.String(),
					page: t.Numeric({ default: 1 })
				}),
				message({ ws }: any) {
					ws.send('ok')
				}
			})
			.listen(0)

		const upgradeResponse = await app.handle(
			new Request('http://localhost/ws', {
				headers: { upgrade: 'websocket' }
			})
		)
		expect(upgradeResponse.status).toBe(422)

		app.stop()
	})
})
