/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Context, Elysia, t } from '../../src'
import { post, req } from '../utils'

describe('code generation', () => {
	it('fallback query if not presented', async () => {
		const app = new Elysia().get('/', () => 'hi', {
			query: t.Object({
				id: t.Optional(t.Number())
			})
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('hi')
	})

	it('process isFnUse', async () => {
		const body = { hello: 'Wanderschaffen' }

		const app = new Elysia()
			.post('/1', ({ body }) => body)
			.post('/2', function ({ body }) {
				return body
			})
			.post('/3', (context) => {
				return context.body
			})
			.post('/4', (context) => {
				const c = context
				const { body } = c

				return body
			})
			.post('/5', (context) => {
				const _ = context,
					a = context
				const { body } = a

				return body
			})
			.post('/6', () => body, {
				transform({ body }) {
					// not empty
				}
			})
			.post('/7', () => body, {
				beforeHandle({ body }) {
					// not empty
				}
			})
			.post('/8', () => body, {
				afterHandle({ body }) {
					// not empty
				}
			})
			.post('/9', ({ ...rest }) => rest.body)

		const from = (number: number) =>
			app.handle(post(`/${number}`, body)).then((r) => r.json())

		const cases = Promise.all(
			Array(9)
				.fill(null)
				.map((_, i) => from(i + 1))
		)

		for (const unit of await cases) expect(unit).toEqual(body)
	})

	it('process isContextPassToUnknown', async () => {
		const body = { hello: 'Wanderschaffen' }

		const handle = (context: Context<any, any>) => context.body

		const app = new Elysia()
			.post('/1', (context) => handle(context))
			.post('/2', function (context) {
				return handle(context)
			})
			.post('/3', (context) => {
				const c = context

				return handle(c)
			})
			.post('/4', (context) => {
				const _ = context,
					a = context

				return handle(a)
			})
			.post('/5', () => '', {
				beforeHandle(context) {
					return handle(context)
				}
			})
			.post('/6', () => body, {
				afterHandle(context) {
					return handle(context)
				}
			})
			.post('/7', ({ ...rest }) => handle(rest))

		const from = (number: number) =>
			app.handle(post(`/${number}`, body)).then((r) => r.json())

		const cases = Promise.all(
			Array(7)
				.fill(null)
				.map((_, i) => from(i + 1))
		)

		for (const unit of await cases) expect(unit).toEqual(body)
	})
})
