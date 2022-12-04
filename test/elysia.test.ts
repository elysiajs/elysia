import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('Elysia', () => {
	it('handle state', async () => {
		const app = new Elysia()
			.state('a', 'a')
			.get('/', ({ store: { a } }) => a)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('a')
	})

	// https://github.com/oven-sh/bun/issues/1523
	it("don't return HTTP 10", async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers.Server = 'Elysia'

			return 'hi'
		})

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
	})

	// If this break, many plugins will break too. DO NOT SKIP
	it('context should be mutable', async () => {
		const app = new Elysia()
			.use(
				(app) =>
					app.onTransform((ctx) => {
						Object.assign(ctx, {
							a: 'a'
						})
					}) as unknown as Elysia<{
						store: {}
						request: {
							a: 'a'
						}
						schema: {}
					}>
			)
			.get('/', ({ a }) => a)

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('a')
	})
})
