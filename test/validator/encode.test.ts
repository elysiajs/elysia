import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Encode response', () => {
	it('handle default status', async () => {
		const app = new Elysia({
			experimental: {
				encodeSchema: true
			}
		}).get(
			'/',
			() => ({
				id: 'hello world'
			}),
			{
				response: t.Object({
					id: t
						.Transform(t.String())
						.Decode((v) => v)
						.Encode(() => 'encoded')
				})
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			id: 'encoded'
		})
	})

	it('handle default named status', async () => {
		const app = new Elysia({
			experimental: {
				encodeSchema: true
			}
		}).get(
			'/:id',
			({ error, params: { id } }) =>
				error(id as any, {
					id: 'hello world'
				}),
			{
				params: t.Object({
					id: t.Number()
				}),
				response: {
					200: t.Object({
						id: t
							.Transform(t.String())
							.Decode((v) => v)
							.Encode(() => 'encoded 200')
					}),
					418: t.Object({
						id: t
							.Transform(t.String())
							.Decode((v) => v)
							.Encode(() => 'encoded 418')
					})
				}
			}
		)

		const response = await Promise.all([
			app.handle(req('/200')).then((x) => x.json()),
			app.handle(req('/418')).then((x) => x.json())
		])

		expect(response[0]).toEqual({
			id: 'encoded 200'
		})

		expect(response[1]).toEqual({
			id: 'encoded 418'
		})
	})
})
