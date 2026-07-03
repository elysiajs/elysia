import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../../src'

describe('Bun adapter', () => {
	it('handle query guard', async () => {
		const app = new Elysia()
			.guard({
				query: t.Object({ a: t.String() })
			})
			.get('/works-with', ({ query }) => 'Works' + query.a)
			.get('/works-without', () => 'Works without')
			.listen(0)

		const query = await fetch(
			`http://localhost:${app.server!.port}/works-with?a=with`
		).then((x) => x.text())

		expect(query).toEqual('Workswith')

		const query2 = await fetch(
			`http://localhost:${app.server!.port}/works-without?a=1`
		).then((x) => x.text())

		expect(query2).toEqual('Works without')
	})

	it('handle standalone query guard', async () => {
		const app = new Elysia()
			.guard({
				query: t.Object({ a: t.String() }),
				schema: 'standalone'
			})
			.get('/works-with', ({ query }) => 'Works' + query.a)
			.get('/works-without', () => 'Works without')
			.listen(0)

		const query = await fetch(
			`http://localhost:${app.server!.port}/works-with?a=with`
		).then((x) => x.text())

		expect(query).toEqual('Workswith')

		const query2 = await fetch(
			`http://localhost:${app.server!.port}/works-without?a=1`
		).then((x) => x.text())

		expect(query2).toEqual('Works without')
	})

	// An always-global `.request()` hook runs at the fetch-handler level, which
	// Bun-native static routes (`serve.routes`) would skip — so a value route
	// like `.get('/', 'yay')` must NOT be promoted to native when a `.request()`
	// hook exists. Otherwise the throwing hook (auth/rate-limit shape) is
	// silently bypassed under `Bun.serve` while `app.handle` runs it: a
	// prod/test divergence. Here the hook throws, `.error()` catches it, and the
	// served body must match `app.handle` ('handled', 400) — not the raw 'yay'.
	it('runs an always-global .request() hook on an otherwise-static route', async () => {
		let caughtError: Error | undefined

		const app = new Elysia()
			.headers({
				'x-header': 'test'
			})
			.error(({ error }) => {
				caughtError = error as Error

				return 'handled'
			})
			.request(({ set }) => {
				set.status = 400

				throw new Error('A')
			})
			.get('/', 'yay')
			.listen(0)

		const response = await fetch(`http://localhost:${app.server!.port}`)

		const text = await response.text()

		expect(text).toBe('handled')
		expect(response.status).toBe(400)
		expect(response.headers.get('x-header')).toBe('test')
		expect(caughtError?.message).toBe('A')

		// parity: the native (Bun.serve) path matches the `app.handle` path
		const handled = await app.handle(new Request('http://localhost/'))
		expect(await handled.text()).toBe('handled')
		expect(handled.status).toBe(400)
	})

	it('handle non-ASCII path', async () => {
		const app = new Elysia().get('/สวัสดี', 'สบายดีไหม').listen(0)

		const response = await fetch(
			`http://localhost:${app.server!.port}/สวัสดี`
		)
		const text = await response.text()
		expect(text).toBe('สบายดีไหม')
	})
})
