import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { trace } from '../../src/plugin/trace'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

const upgrade = () =>
	req('/ws', { headers: { upgrade: 'websocket', connection: 'Upgrade' } })

describe('HTTP routing with WebSocket routes', () => {
	it('resolves a static HTTP route when a request hook is registered', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', { message() {} })
			.request(() => {})
			.get('/ok', () => 'ok')

		const res = await app.handle('/ok')
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
	})

	it('resolves a static HTTP route when tracing is registered', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(() => {})
			.use(websocket())
			.ws('/ws', { message() {} })
			.get('/ok', () => 'ok')

		const res = await app.handle('/ok')
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
	})

	it('resolves a dynamic HTTP route when a request hook is registered', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', { message() {} })
			.request(() => {})
			.get('/id/:id', ({ params }) => params.id)

		const res = await app.handle('/id/42')
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('42')
	})

	it('returns 404 for an unmatched HTTP path', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', { message() {} })
			.request(() => {})
			.get('/ok', () => 'ok')

		const res = await app.handle('/missing')
		expect(res.status).toBe(404)
	})
})

describe('WebSocket route hook snapshots', () => {
	it('runs a plugin-local beforeHandle registered before the route', async () => {
		let ran = 0
		const plugin = new Elysia()
			.beforeHandle(() => {
				ran++
				return new Response('blocked', { status: 403 })
			})
			.use(websocket())
			.ws('/ws', { message() {} })

		const app = new Elysia().use(plugin)

		const res = await app.handle(upgrade())
		expect(ran).toBe(1)
		expect(res!.status).toBe(403)
		await expect(res!.text()).resolves.toBe('blocked')
	})

	it('ignores a beforeHandle registered after the route', async () => {
		let leaked = 0
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', { message() {} })
			.beforeHandle(() => {
				leaked++
				return new Response('blocked', { status: 403 })
			})

		const res = await app.handle(upgrade())
		expect(leaked).toBe(0)
		expect(res!.status).not.toBe(403)
	})

	it('runs a group-scoped beforeHandle on the upgrade', async () => {
		let ran = 0
		const app = new Elysia().group('/api', (a) =>
			a
				.beforeHandle(() => {
					ran++
					return new Response('nope', { status: 401 })
				})
				.use(websocket())
				.ws('/ws', { message() {} })
		)

		const res = await app.handle('/api/ws', {
			headers: { upgrade: 'websocket', connection: 'Upgrade' }
		})
		expect(ran).toBe(1)
		expect(res!.status).toBe(401)
	})
})
