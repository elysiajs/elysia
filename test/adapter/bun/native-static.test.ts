import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../../src'
import { collectStaticRoutes } from '../../../src/adapter/bun'

describe('Bun native static promotion', () => {
	it('keeps pure literals promoted by default', async () => {
		const app = new Elysia().get('/literal', 'literal')
		const promoted = collectStaticRoutes(app as any)

		expect(promoted?.['/literal']?.GET).toBeInstanceOf(Response)
		await expect(promoted!['/literal'].GET.text()).resolves.toBe('literal')
	})

	it('keeps .all() on the JS lane without a later rejection', async () => {
		const rejections: unknown[] = []
		const onUnhandled = (error: unknown) => rejections.push(error)
		process.on('unhandledRejection', onUnhandled)

		let app: Elysia | undefined
		try {
			expect(() => {
				app = new Elysia().all('/all', 'all').listen(0)
			}).not.toThrow()

			await Bun.sleep(20)
			const response = await fetch(
				`http://localhost:${app!.server!.port}/all`
			)
			await expect(response.text()).resolves.toBe('all')
			expect(rejections).toEqual([])
		} finally {
			process.off('unhandledRejection', onUnhandled)
			await app?.stop(true)
		}
	})

	it('runs afterResponse on a real request instead of promoting', async () => {
		let fired = 0
		const app = new Elysia().get(
			'/after-response',
			{
				afterResponse() {
					fired++
				}
			},
			'after-response'
		)

		expect(collectStaticRoutes(app as any)).toBeUndefined()
		app.listen(0)

		try {
			const response = await fetch(
				`http://localhost:${app.server!.port}/after-response`
			)
			await expect(response.text()).resolves.toBe('after-response')
			await Bun.sleep(0)
			expect(fired).toBe(1)
		} finally {
			await app.stop(true)
		}
	})

	it('keeps request-dependent handlers on the JS lane', async () => {
		const app = new Elysia().get('/header', ({ request }) =>
			request.headers.get('x-value')
		)

		expect(collectStaticRoutes(app as any)).toBeUndefined()
		app.listen(0)

		try {
			const url = `http://localhost:${app.server!.port}/header`
			await expect(
				fetch(url, { headers: { 'x-value': 'one' } }).then((x) =>
					x.text()
				)
			).resolves.toBe('one')
			await expect(
				fetch(url, { headers: { 'x-value': 'two' } }).then((x) =>
					x.text()
				)
			).resolves.toBe('two')
		} finally {
			await app.stop(true)
		}
	})

	it('maps request-dependent static output per request', async () => {
		const app = new Elysia().get(
			'/mapped-header',
			{
				mapResponse({ request }) {
					return new Response(
						request.headers.get('x-value') ?? 'missing'
					)
				}
			},
			'literal'
		)

		expect(collectStaticRoutes(app as any)).toBeUndefined()
		app.listen(0)

		try {
			const url = `http://localhost:${app.server!.port}/mapped-header`
			await expect(
				fetch(url, { headers: { 'x-value': 'one' } }).then((x) =>
					x.text()
				)
			).resolves.toBe('one')
			await expect(
				fetch(url, { headers: { 'x-value': 'two' } }).then((x) =>
					x.text()
				)
			).resolves.toBe('two')
		} finally {
			await app.stop(true)
		}
	})

	it('serves synchronous static routes alongside dynamic routes', async () => {
		const app = new Elysia()
			.get('/static', 'static-value')
			.get('/dyn/:id', ({ params: { id } }) => `dyn:${id}`)
			.listen(0)

		await Bun.sleep(50)

		const base = `http://localhost:${app.server!.port}`
		await expect(
			fetch(`${base}/static`).then((x) => x.text())
		).resolves.toBe('static-value')
		await expect(
			fetch(`${base}/dyn/1`).then((x) => x.text())
		).resolves.toBe('dyn:1')

		app.stop()
	})

	it('keeps a dynamic path static-value route on the JS lane', async () => {
		const app = new Elysia()
			.get('/user/:id', 'dynamic')
			.get('/user/me', () => 'me')
			.get('/health', 'ok')

		// Bun matches `routes` before the fallback `fetch`, so promoting the
		// dynamic literal would swallow `/user/me`, which is ineligible and
		// stays on the JS router
		const promoted = collectStaticRoutes(app as any)
		expect(promoted?.['/health']?.GET).toBeInstanceOf(Response)
		expect(promoted?.['/user/:id']).toBeUndefined()

		app.listen(0)
		await Bun.sleep(50)

		try {
			const base = `http://localhost:${app.server!.port}`
			await expect(
				fetch(`${base}/user/me`).then((x) => x.text())
			).resolves.toBe('me')
			await expect(
				fetch(`${base}/user/1`).then((x) => x.text())
			).resolves.toBe('dynamic')
		} finally {
			await app.stop(true)
		}
	})

	it('keeps routes with an error hook on the JS lane', async () => {
		let fired = 0
		const app = new Elysia()
			.error(() => {
				fired++
			})
			.get('/health', 'ok')

		expect(collectStaticRoutes(app as any)).toBeUndefined()

		app.listen(0)
		await Bun.sleep(50)

		const base = `http://localhost:${app.server!.port}`
		const hit = await fetch(`${base}/health`)
		expect(hit.status).toBe(200)
		await expect(hit.text()).resolves.toBe('ok')
		expect(fired).toBe(0)

		expect((await fetch(`${base}/missing`)).status).toBe(404)
		expect(fired).toBe(1)

		app.stop()
	})

	it('validates static-value routes with schemas on the JS lane', async () => {
		const app = new Elysia()
			.error(() => {})
			.get('/q', { query: t.Object({ id: t.String() }) }, 'ok')
			.listen(0)

		await Bun.sleep(50)

		const base = `http://localhost:${app.server!.port}`
		expect((await fetch(`${base}/q`)).status).toBe(422)

		const valid = await fetch(`${base}/q?id=1`)
		expect(valid.status).toBe(200)
		await expect(valid.text()).resolves.toBe('ok')

		app.stop()
	})

	it('runs mapResponse for static-value routes on the JS lane', async () => {
		const app = new Elysia()
			.mapResponse(() => new Response('MAPPED'))
			.get('/health', 'ok')
			.listen(0)

		await Bun.sleep(50)

		await expect(
			fetch(`http://localhost:${app.server!.port}/health`).then((x) =>
				x.text()
			)
		).resolves.toBe('MAPPED')

		app.stop()
	})
})
