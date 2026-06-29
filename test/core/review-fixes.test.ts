import { Elysia } from '../../src'
import { mime } from '../../src/universal/file'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

const upgrade = () =>
	req('/ws', { headers: { upgrade: 'websocket', connection: 'Upgrade' } })

describe('review fixes', () => {
	describe('WS-present apps still route HTTP', () => {
		it('resolves an HTTP route when a WS route + request hook exist', async () => {
			const app = new Elysia()
				.ws('/ws', { message() {} })
				.request(() => {})
				.get('/ok', () => 'ok')

			const res = await app.handle(req('/ok'))
			expect(res.status).toBe(200)
			await expect(res.text()).resolves.toBe('ok')
		})

		it('resolves an HTTP route when a WS route + trace exist', async () => {
			const app = new Elysia()
				.trace(() => {})
				.ws('/ws', { message() {} })
				.get('/ok', () => 'ok')

			const res = await app.handle(req('/ok'))
			expect(res.status).toBe(200)
			await expect(res.text()).resolves.toBe('ok')
		})

		it('resolves a DYNAMIC HTTP route alongside a WS route + request hook', async () => {
			const app = new Elysia()
				.ws('/ws', { message() {} })
				.request(() => {})
				.get('/id/:id', ({ params }) => params.id)

			const res = await app.handle(req('/id/42'))
			expect(res.status).toBe(200)
			await expect(res.text()).resolves.toBe('42')
		})

		it('still returns 404 for a genuinely missing path', async () => {
			const app = new Elysia()
				.ws('/ws', { message() {} })
				.request(() => {})
				.get('/ok', () => 'ok')

			const res = await app.handle(req('/missing'))
			expect(res.status).toBe(404)
		})
	})

	describe('WS upgrade composes hooks from the route snapshot', () => {
		it('runs a plugin-local beforeHandle on the WS upgrade', async () => {
			let ran = 0
			const plugin = new Elysia()
				.beforeHandle(() => {
					ran++
					return new Response('blocked', { status: 403 })
				})
				.ws('/ws', { message() {} })

			const app = new Elysia().use(plugin)

			const res = await app.handle(upgrade())
			expect(ran).toBe(1)
			expect(res!.status).toBe(403)
			await expect(res!.text()).resolves.toBe('blocked')
		})

		it('does not leak a beforeHandle registered AFTER .ws() into that route', async () => {
			let leaked = 0
			const app = new Elysia()
				.ws('/ws', { message() {} })
				.beforeHandle(() => {
					leaked++
					return new Response('blocked', { status: 403 })
				})

			const res = await app.handle(upgrade())
			expect(leaked).toBe(0)
			expect(res!.status).not.toBe(403)
		})

		it('runs a group-scoped beforeHandle on the WS upgrade', async () => {
			let ran = 0
			const app = new Elysia().group('/api', (a) =>
				a
					.beforeHandle(() => {
						ran++
						return new Response('nope', { status: 401 })
					})
					.ws('/ws', { message() {} })
			)

			const res = await app.handle(
				req('/api/ws', {
					headers: { upgrade: 'websocket', connection: 'Upgrade' }
				})
			)
			expect(ran).toBe(1)
			expect(res!.status).toBe(401)
		})
	})

	describe('afterResponse on request-hook errors', () => {
		it('runs afterResponse when a synchronous request hook throws', async () => {
			let ran = false
			const app = new Elysia()
				.request(() => {
					throw new Error('boom')
				})
				.afterResponse(() => {
					ran = true
				})
				.get('/x', () => 'x')

			const res = await app.handle(req('/x'))
			expect(res.status).toBe(500)

			// afterResponse is scheduled on a microtask
			await new Promise((r) => setTimeout(r, 10))
			expect(ran).toBe(true)
		})

		it('afterResponse observes the final status from an async error handler', async () => {
			let observed: number | undefined
			const app = new Elysia()
				.error(async () => {
					await Promise.resolve()
					return new Response('teapot', { status: 418 })
				})
				.request(async () => {
					await Promise.resolve()
					throw new Error('boom')
				})
				.afterResponse((ctx) => {
					observed = ctx.set.status as number
				})
				.get('/y', () => 'y')

			const res = await app.handle(req('/y'))
			expect(res.status).toBe(418)

			await new Promise((r) => setTimeout(r, 20))
			expect(observed).toBe(418)
		})

		it('afterResponse observes the final status when a route handler throws (async error handler)', async () => {
			let observed: number | undefined
			const app = new Elysia()
				.error(async () => {
					await Promise.resolve()
					return new Response('teapot', { status: 418 })
				})
				.afterResponse((ctx) => {
					observed = ctx.set.status as number
				})
				.get('/z', () => {
					throw new Error('boom')
				})

			const res = await app.handle(req('/z'))
			expect(res.status).toBe(418)

			await new Promise((r) => setTimeout(r, 20))
			expect(observed).toBe(418)
		})
	})

	describe('MIME table has no double slashes', () => {
		it('produces valid application/* MIME types', () => {
			for (const [ext, value] of Object.entries(mime))
				expect(value, `mime[${ext}]`).not.toContain('//')
		})

		it('maps common application types correctly', () => {
			expect(mime.json).toBe('application/json')
			expect(mime.js).toBe('application/javascript')
			expect(mime.xml).toBe('application/xml')
			expect(mime.pdf).toBe('application/pdf')
			expect(mime.zip).toBe('application/zip')
			expect(mime.doc).toBe('application/msword')
		})
	})
})
