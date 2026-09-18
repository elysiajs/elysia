import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { wsOpen, wsClosed, wsMessage } from './utils'

// headers/query/cookie must follow the same availability semantics as HTTP:
// a handler that touches the channel gets it materialized even without a
// schema, and an untouched channel stays unmaterialized.
describe('WebSocket context inference', () => {
	const connect = (server: any, path: string) =>
		new WebSocket(`ws://${server.hostname}:${server.port}${path}`, {
			headers: { 'x-user': 'alice', cookie: 'sid=abc' }
		} as any)

	it('materializes headers, query and cookie without a schema', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message(ws) {
					ws.send({
						user: ws.headers['x-user'],
						by: ws.query.by,
						sid: ws.cookie.sid.value
					})
				}
			})
			.listen(0)

		const ws = connect(app.server!, '/ws?by=tab-1')
		await wsOpen(ws)
		const message = wsMessage(ws)
		ws.send('hi')

		expect(JSON.parse((await message).data as string)).toEqual({
			user: 'alice',
			by: 'tab-1',
			sid: 'abc'
		})

		await wsClosed(ws)
		app.stop()
	})

	it('materializes for a hook that passes the context to a helper', async () => {
		const getIdentity = (ctx: any) => ctx.headers['x-user']

		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message(ws) {
					ws.send(getIdentity(ws))
				}
			})
			.listen(0)

		const ws = connect(app.server!, '/ws')
		await wsOpen(ws)
		const message = wsMessage(ws)
		ws.send('hi')

		expect((await message).data).toBe('alice')

		await wsClosed(ws)
		app.stop()
	})

	it('materializes on upgrade-time hooks (beforeHandle, open)', async () => {
		let upgradeUser: string | undefined

		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				beforeHandle(ctx: any) {
					if (ctx.body === undefined) upgradeUser = ctx.headers['x-user']
				},
				open(ws) {
					ws.send(`${ws.headers['x-user']}:${ws.query.by}`)
				}
			})
			.listen(0)

		const ws = connect(app.server!, '/ws?by=tab-2')
		const message = wsMessage(ws)
		await wsOpen(ws)

		expect((await message).data).toBe('alice:tab-2')
		expect(upgradeUser).toBe('alice')

		await wsClosed(ws)
		app.stop()
	})

	it('materializes channels read through a destructured `ws` self-reference', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message({ ws }: any) {
					ws.send(`${ws.headers['x-user']}:${ws.query.by}`)
				}
			})
			.listen(0)

		const ws = connect(app.server!, '/ws?by=tab-4')
		await wsOpen(ws)
		const message = wsMessage(ws)
		ws.send('hi')

		expect((await message).data).toBe('alice:tab-4')

		await wsClosed(ws)
		app.stop()
	})

	it('does not infer channels from a destructured message body parameter', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message({ ws, send }: any, { cookie }: any) {
					send(`${cookie}:${'cookie' in ws.data.elysia}`)
				}
			})
			.listen(0)

		const ws = connect(app.server!, '/ws')
		await wsOpen(ws)
		const message = wsMessage(ws)
		ws.send(JSON.stringify({ cookie: 'from-body' }))

		expect((await message).data).toBe('from-body:false')

		await wsClosed(ws)
		app.stop()
	})

	it('defers signature verification like HTTP instead of failing the upgrade', async () => {
		const app = new Elysia({
			cookie: { secrets: 'secret-key', sign: ['sid'] }
		})
			.use(websocket())
			.ws('/ws', {
				message(ws) {
					ws.send(String(ws.cookie.other?.value))
				}
			})
			.listen(0)

		const ws = new WebSocket(
			`ws://${app.server!.hostname}:${app.server!.port}/ws`,
			{
				headers: { cookie: 'sid=forged.signature; other=hi' }
			} as any
		)
		await wsOpen(ws)
		const message = wsMessage(ws)
		ws.send('hi')

		expect((await message).data).toBe('hi')

		await wsClosed(ws)
		app.stop()
	})

	it('leaves untouched channels unmaterialized', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message(ws) {
					const view = (ws as any).data.elysia
					ws.send(
						`${'headers' in view}:${'query' in view}:${'cookie' in view}`
					)
				}
			})
			.listen(0)

		const ws = connect(app.server!, '/ws?by=tab-3')
		await wsOpen(ws)
		const message = wsMessage(ws)
		ws.send('hi')

		expect((await message).data).toBe('false:false:false')

		await wsClosed(ws)
		app.stop()
	})
})
