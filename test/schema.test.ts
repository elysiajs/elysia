import { Elysia, t } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

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

	it('validate params', async () => {
		const app = new Elysia().get(
			'/hi/:id/:name',
			({ params: { name } }) => name,
			{
				schema: {
					params: t.Object({
						id: t.String(),
						name: t.String()
					})
				}
			}
		)
		const res = await app.handle(req('/hi/1/sucrose'))

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate headers', async () => {
		const app = new Elysia().post('/', () => 'welcome back', {
			schema: {
				headers: t.Object({
					authorization: t.String()
				})
			}
		})
		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'post',
				headers: {
					authorization: 'Bearer 123',
					// optional header should be allowed
					'x-forwarded-ip': '127.0.0.1'
				}
			})
		)

		expect(await res.text()).toBe('welcome back')
		expect(res.status).toBe(200)
	})

	it('validate body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			schema: {
				body: t.Object({
					username: t.String(),
					password: t.String()
				})
			}
		})

		const body = JSON.stringify({
			username: 'ceobe',
			password: '12345678'
		})

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'post',
				body,
				headers: {
					'content-type': 'application/json'
				}
			})
		)

		expect(await res.text()).toBe(body)
		expect(res.status).toBe(200)
	})

	it('validate response', async () => {
		const app = new Elysia().get(
			'/',
			() => 'Mutsuki need correction 💢💢💢',
			{
				schema: {
					response: t.String()
				}
			}
		)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Mutsuki need correction 💢💢💢')
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
			new Request('http://localhost/user?name=salt', {
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

		const invalidQuery = await app.handle(
			new Request('http://localhost/user', {
				method: 'POST',
				body: JSON.stringify({
					id: 6,
					username: '',
					profile: {
						name: 'A'
					}
				})
			})
		)

		expect(invalidQuery.status).toBe(400)

		const invalidBody = await app.handle(
			new Request('http://localhost/user?name=salt', {
				method: 'POST',
				body: JSON.stringify({
					id: 6,
					username: '',
					profile: {}
				})
			})
		)

		expect(invalidBody.status).toBe(400)
	})

	// https://github.com/elysiajs/elysia/issues/28
	// Error is possibly from reference object from `registerSchemaPath`
	// Most likely missing an deep clone object
	it('validate group response', async () => {
		const app = new Elysia()
			.group('/deep', (app) =>
				app
					.get('/correct', () => 'a', {
						schema: {
							response: {
								200: t.String(),
								400: t.String()
							}
						}
					})
					.get('/wrong', () => 1 as any, {
						schema: {
							response: {
								200: t.String(),
								400: t.String()
							}
						}
					})
			)
			.listen(8080)

		const correct = await app
			.handle(req('/deep/correct'))
			.then((x) => x.status)
		const wrong = await app.handle(req('/deep/wrong')).then((x) => x.status)

		expect(correct).toBe(200)
		expect(wrong).toBe(400)
	})
})
