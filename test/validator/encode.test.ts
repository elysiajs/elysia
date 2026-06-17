import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Encode response', () => {
	it('handle default status', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Object({
					id: t
						.Codec(t.String())
						.Decode((v) => v)
						.Encode(() => 'encoded')
				})
			},
			() => ({
				id: 'hello world'
			})
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			id: 'encoded'
		})
	})

	it('handle default named status', async () => {
		const app = new Elysia().get(
			'/:id',
			{
				params: t.Object({
					id: t.Number()
				}),
				response: {
					200: t.Object({
						id: t
							.Codec(t.String())
							.Decode((v) => v)
							.Encode(() => 'encoded 200')
					}),
					418: t.Object({
						id: t
							.Codec(t.String())
							.Decode((v) => v)
							.Encode(() => 'encoded 418')
					})
				}
			},
			({ status, params: { id } }) =>
				status(id as any, {
					id: 'hello world'
				})
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

	it('Encode before type check', async () => {
		const dto = t.Object({
			value: t
				.Codec(t.String())
				.Decode((value) => parseFloat(value))
				.Encode((value) => value.toString())
		})

		let bodyType = ''

		const elysia = new Elysia().post(
			'/',
			{
				body: dto,
				response: dto
			},
			({ body }) => {
				bodyType = typeof body.value

				return body
			}
		)

		const response = await elysia
			.handle(
				new Request('http://localhost:3000/', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ value: '1.1' })
				})
			)
			.then((res) => res)

		expect(bodyType).toBe('number')
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ value: '1.1' })
	})
})
