import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsClosed, wsMessage } from './utils'

// a WebSocket route runs `transform` before validation, as an HTTP route does,
// so a transform can prepare input and its writes are validated

const asyncName = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate: (value: any) =>
			Promise.resolve(
				typeof value?.name === 'string' && value.name !== 'taken'
					? { value }
					: { issues: [{ message: 'name is taken' }] }
			)
	}
} as any

const upgradeHeaders = {
	upgrade: 'websocket',
	connection: 'Upgrade',
	'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
	'sec-websocket-version': '13'
}

// no pooled connection: a kept-alive socket would answer for the next app on the port
const upgrade = (app: any, path: string) =>
	fetch(`http://${app.server.hostname}:${app.server.port}${path}`, {
		headers: upgradeHeaders,
		keepalive: false
	})

describe('WebSocket transform order: upgrade lane', () => {
	it('transform sees raw query', async () => {
		let seen: string | undefined

		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				query: t.Object({ n: t.Number() }),
				transform({ query }: any) {
					seen = typeof query.n
				},
				open(ws) {
					ws.send(JSON.stringify(ws.query))
				}
			})
			.listen(0)

		try {
			const ws = newWebsocket(app.server!, '/ws?n=1')
			const message = wsMessage(ws)
			await wsOpen(ws)

			expect(seen).toBe('string')
			expect((await message).data).toBe('{"n":1}')

			await wsClosed(ws)
		} finally {
			app.stop()
		}
	})

	it('transform can fill a default', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				query: t.Object({ n: t.Number() }),
				transform({ query }: any) {
					if (query.n === undefined) query.n = '5'
				},
				open(ws) {
					ws.send(JSON.stringify(ws.query))
				}
			})
			.listen(0)

		try {
			const ws = newWebsocket(app.server!, '/ws')
			const message = wsMessage(ws)
			await wsOpen(ws)

			expect((await message).data).toBe('{"n":5}')

			await wsClosed(ws)
		} finally {
			app.stop()
		}
	})

	it('transform writes are validated', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				query: t.Object({ n: t.Number() }),
				transform({ query }: any) {
					query.n = 'not-a-number'
				},
				open(ws) {
					ws.send('open')
				}
			})
			.listen(0)

		try {
			const res = await upgrade(app, '/ws?n=1')

			expect(res.status).toBe(422)
		} finally {
			app.stop()
		}
	})

	it('transform sees raw params', async () => {
		let seen: string | undefined

		const app = new Elysia()
			.use(websocket())
			.ws('/ws/:id', {
				params: t.Object({ id: t.Number() }),
				transform({ params }: any) {
					seen = typeof params.id
				},
				open(ws) {
					ws.send(typeof ws.params.id)
				}
			})
			.listen(0)

		try {
			const ws = newWebsocket(app.server!, '/ws/1')
			const message = wsMessage(ws)
			await wsOpen(ws)

			expect(seen).toBe('string')
			expect((await message).data).toBe('number')

			await wsClosed(ws)
		} finally {
			app.stop()
		}
	})
})

describe('WebSocket transform order: message lane', () => {
	it('transform can fill a default in the body', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				body: t.Object({ n: t.Number() }),
				// the same hook also runs once for the upgrade, with no body
				transform(ws: any) {
					if (ws.body && ws.body.n === undefined) ws.body.n = 5
				},
				message(ws, body) {
					ws.send(JSON.stringify(body))
				}
			})
			.listen(0)

		try {
			const ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const message = wsMessage(ws)
			ws.send(JSON.stringify({}))

			expect((await message).data).toBe('{"n":5}')

			await wsClosed(ws)
		} finally {
			app.stop()
		}
	})

	it('transform writes to the body are validated', async () => {
		let ran = false

		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				body: t.Object({ n: t.Number() }),
				transform(ws: any) {
					if (ws.body) ws.body.n = 'x'
				},
				message(ws) {
					ran = true
					ws.send('handler')
				}
			})
			.listen(0)

		try {
			const ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const message = wsMessage(ws)
			ws.send(JSON.stringify({ n: 1 }))

			const frame = JSON.parse(String((await message).data))
			expect(frame.status).toBe(422)
			expect(ran).toBe(false)

			await wsClosed(ws)
		} finally {
			app.stop()
		}
	})

	it('fills a default in the body with afterResponse', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				body: t.Object({ n: t.Number() }),
				transform(ws: any) {
					if (ws.body && ws.body.n === undefined) ws.body.n = 5
				},
				afterResponse() {},
				message(ws, body) {
					ws.send(JSON.stringify(body))
				}
			})
			.listen(0)

		try {
			const ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const message = wsMessage(ws)
			ws.send(JSON.stringify({}))

			expect((await message).data).toBe('{"n":5}')

			await wsClosed(ws)
		} finally {
			app.stop()
		}
	})
})

describe('WebSocket async Standard Schema', () => {
	it('validates the query', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				query: asyncName,
				open(ws) {
					ws.send('open')
				}
			})
			.listen(0)

		try {
			expect((await upgrade(app, '/ws?name=ok')).status).toBe(101)
			expect((await upgrade(app, '/ws?name=taken')).status).toBe(422)
		} finally {
			app.stop()
		}
	})

	it('validates the message body', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				body: asyncName,
				message(ws, body: any) {
					ws.send('ok:' + body.name)
				}
			})
			.listen(0)

		try {
			const ws = newWebsocket(app.server!)
			await wsOpen(ws)

			const ok = wsMessage(ws)
			ws.send(JSON.stringify({ name: 'ok' }))
			expect((await ok).data).toBe('ok:ok')

			const bad = wsMessage(ws)
			ws.send(JSON.stringify({ name: 'taken' }))
			const frame = JSON.parse(String((await bad).data))
			expect(frame.status).toBe(422)

			await wsClosed(ws)
		} finally {
			app.stop()
		}
	})
})
