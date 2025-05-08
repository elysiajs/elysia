import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Exact Mirror', () => {
	it('normalize when t.Transform is provided', async () => {
		const app = new Elysia({
			normalize: 'exactMirror'
		}).get('/', () => ({ count: 2, name: 'foo', extra: 1 }), {
			response: t.Object(
				{ name: t.String(), count: t.Optional(t.Integer()) },
				{ additionalProperties: false }
			)
		})
	})

	it('leave incorrect union field as-is', async () => {
		const app = new Elysia().post(
			'/test',
			({ body }) => {
				console.log({ body })

				return 'Hello Elysia'
			},
			{
				body: t.Object({
					foo: t.Optional(
						t.Nullable(
							t.Number({
								// 'foo' but be either number, optional or nullable
								error: 'Must be a number'
							})
						)
					)
				})
			}
		)

		const response = await app.handle(
			post('/test', {
				foo: 'asd'
			})
		)

		expect(response.status).toEqual(422)
	})

	it('normalize array response', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					messages: [
						{
							message: 'Hello, world!',
							shouldBeRemoved: true
						}
					]
				}
			},
			{
				response: {
					200: t.Object({
						messages: t.Array(
							t.Object({
								message: t.String()
							})
						)
					})
				}
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			messages: [{ message: 'Hello, world!' }]
		})
	})
})
