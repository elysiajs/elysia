import { Elysia, t } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('Schema', () => {
	it('validate query', async () => {
		const app = new Elysia().get('/', ({ query: { name } }) => name, {
			schema: {
				query: t.Object({
					name: t.String()
				})
			}
		})
		const res = await app.handle(req('/?name=sucrose'))

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('handle guard hook', async () => {
		const app = new Elysia().guard(
			{
				schema: {
					query: t.Object({
						name: t.String()
					})
				}
			},
			(app) =>
				app
					// Store is inherited
					.post('/user', ({ query: { name } }) => name, {
						schema: {
							body: t.Object({
								id: t.Number(),
								username: t.String(),
								profile: t.Object({
									name: t.String()
								})
							})
						}
					})
		)

		const body = JSON.stringify({
			id: 6,
			username: '',
			profile: {
				name: 'A'
			}
		})

		const valid = await app.handle(
			new Request('/user?name=salt', {
				method: 'POST',
				body,
				headers: {
					'content-type': 'application/json',
					'content-length': body.length.toString()
				}
			})
		)

		expect(await valid.text()).toBe('salt')
		expect(valid.status).toBe(200)

		// const invalidQuery = await app.handle(
		// 	new Request('/user', {
		// 		method: 'POST',
		// 		body: JSON.stringify({
		// 			id: 6,
		// 			username: '',
		// 			profile: {
		// 				name: 'A'
		// 			}
		// 		})
		// 	})
		// )

		// expect(await invalidQuery.text()).toBe(
		// 	"Invalid query, root should have required property 'name'"
		// )
		// expect(valid.status).toBe(400)

		// const invalidBody = await app.handle(
		// 	new Request('/user?name=salt', {
		// 		method: 'POST',
		// 		body: JSON.stringify({
		// 			id: 6,
		// 			username: '',
		// 			profile: {}
		// 		})
		// 	})
		// )

		// expect(await invalidQuery.text()).toBe(
		// 	"Invalid query, root should have required property 'name'"
		// )
		// expect(invalidBody.status).toBe(400)

		// expect(await invalidBody.text()).toBe(
		// 	"Invalid body, .profile should have required property 'name'"
		// )
		// expect(invalidBody.status).toBe(400)
	})
})
