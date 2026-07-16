import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'
import { collectStaticRoutes } from '../../../src/adapter/bun'

describe('Bun native static promotion', () => {
	it('keeps pure literals promoted by default', async () => {
		const app = new Elysia().get('/literal', 'literal')
		const promoted = collectStaticRoutes(app as any)?.[0]

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
})
