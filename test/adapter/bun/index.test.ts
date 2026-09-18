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

	it('handle merge query guard', async () => {
		const app = new Elysia()
			.guard({
				query: t.Object({ a: t.String() }),
				schema: 'merge'
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

	it('runs an always-global request hook through Bun.serve and app.handle', async () => {
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

		const handled = await app.handle(new Request('http://localhost/'))
		await expect(handled.text()).resolves.toBe('handled')
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
