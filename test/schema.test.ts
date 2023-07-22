import { Elysia, t } from '../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from './utils'

describe('Schema', () => {
	it('validate query', async () => {
		const app = new Elysia().get('/', ({ query: { name } }) => name, {
			query: t.Object({
				name: t.String()
			})
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
				params: t.Object({
					id: t.String(),
					name: t.String()
				})
			}
		)
		const res = await app.handle(req('/hi/1/sucrose'))

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate headers', async () => {
		const app = new Elysia().post('/', () => 'welcome back', {
			headers: t.Object({
				authorization: t.String()
			})
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
			body: t.Object({
				username: t.String(),
				password: t.String()
			})
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
		const app = new Elysia()
			.get('/', () => 'Mutsuki need correction 💢💢💢', {
				response: t.String()
			})
			.get('/invalid', () => 1 as any, {
				response: t.String()
			})
		const res = await app.handle(req('/'))
		const invalid = await app.handle(req('/invalid'))

		expect(await res.text()).toBe('Mutsuki need correction 💢💢💢')
		expect(res.status).toBe(200)

		expect(invalid.status).toBe(400)
	})

	it('validate beforeHandle', async () => {
		const app = new Elysia()
			.get('/', () => 'Mutsuki need correction 💢💢💢', {
				beforeHandle() {
					return 'Mutsuki need correction 💢💢💢'
				},
				response: t.String()
			})
			.get('/invalid', () => 1 as any, {
				beforeHandle() {
					return 1 as any
				},
				response: t.String()
			})
		const res = await app.handle(req('/'))
		const invalid = await app.handle(req('/invalid'))

		expect(await res.text()).toBe('Mutsuki need correction 💢💢💢')
		expect(res.status).toBe(200)

		expect(invalid.status).toBe(400)
	})

	it('validate afterHandle', async () => {
		const app = new Elysia()
			.get('/', () => 'Mutsuki need correction 💢💢💢', {
				afterHandle() {
					return 'Mutsuki need correction 💢💢💢'
				},
				response: t.String()
			})
			.get('/invalid', () => 1 as any, {
				afterHandle() {
					return 1 as any
				},
				response: t.String()
			})
		const res = await app.handle(req('/'))
		const invalid = await app.handle(req('/invalid'))

		expect(await res.text()).toBe('Mutsuki need correction 💢💢💢')
		expect(res.status).toBe(200)

		expect(invalid.status).toBe(400)
	})

	it('validate beforeHandle with afterHandle', async () => {
		const app = new Elysia()
			.get('/', () => 'Mutsuki need correction 💢💢💢', {
				beforeHandle() {
					// Not Empty
				},
				afterHandle() {
					return 'Mutsuki need correction 💢💢💢'
				},
				response: t.String()
			})
			.get('/invalid', () => 1 as any, {
				afterHandle() {
					return 1 as any
				},
				response: t.String()
			})
		const res = await app.handle(req('/'))
		const invalid = await app.handle(req('/invalid'))

		expect(await res.text()).toBe('Mutsuki need correction 💢💢💢')
		expect(res.status).toBe(200)

		expect(invalid.status).toBe(400)
	})

	it('validate response per status', async () => {
		const app = new Elysia().post(
			'/',
			({ set, body: { status, response } }) => {
				set.status = status

				return response
			},
			{
				body: t.Object({
					status: t.Number(),
					response: t.Any()
				}),
				response: {
					200: t.String(),
					201: t.Number()
				}
			}
		)

		const r200valid = await app.handle(
			post('/', {
				status: 200,
				response: 'String'
			})
		)
		const r200invalid = await app.handle(
			post('/', {
				status: 200,
				response: 1
			})
		)

		const r201valid = await app.handle(
			post('/', {
				status: 201,
				response: 1
			})
		)
		const r201invalid = await app.handle(
			post('/', {
				status: 201,
				response: 'String'
			})
		)

		expect(r200valid.status).toBe(200)
		expect(r200invalid.status).toBe(400)
		expect(r201valid.status).toBe(201)
		expect(r201invalid.status).toBe(400)
	})

	it('handle guard hook', async () => {
		const app = new Elysia().guard(
			{
				query: t.Object({
					name: t.String()
				})
			},
			(app) =>
				app
					// Store is inherited
					.post('/user', ({ query: { name } }) => name, {
						body: t.Object({
							id: t.Number(),
							username: t.String(),
							profile: t.Object({
								name: t.String()
							})
						})
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

		// const invalidBody = await app.handle(
		// 	new Request('http://localhost/user?name=salt', {
		// 		method: 'POST',
		// 		body: JSON.stringify({
		// 			id: 6,
		// 			username: '',
		// 			profile: {}
		// 		})
		// 	})
		// )

		// expect(invalidBody.status).toBe(400)
	})

	// https://github.com/elysiajs/elysia/issues/28
	// Error is possibly from reference object from `registerSchemaPath`
	// Most likely missing an deep clone object
	it('validate group response', async () => {
		const app = new Elysia().group('/deep', (app) =>
			app
				.get('/correct', () => 'a', {
					response: {
						200: t.String(),
						400: t.String()
					}
				})
				.get('/wrong', () => 1 as any, {
					response: {
						200: t.String(),
						400: t.String()
					}
				})
		)

		const correct = await app
			.handle(req('/deep/correct'))
			.then((x) => x.status)
		const wrong = await app.handle(req('/deep/wrong')).then((x) => x.status)

		expect(correct).toBe(200)
		expect(wrong).toBe(400)
	})

	it('validate union', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Union([
				t.Object({
					password: t.String()
				}),
				t.Object({
					token: t.String()
				})
			])
		})

		const r1 = await app
			.handle(
				post('/', {
					password: 'a'
				})
			)
			.then((x) => x.status)
		const r2 = await app
			.handle(
				post('/', {
					token: 'a'
				})
			)
			.then((x) => x.status)
		const r3 = await app
			.handle(
				post('/', {
					notUnioned: true
				})
			)
			.then((x) => x.status)

		expect(r1).toBe(200)
		expect(r2).toBe(200)
		expect(r3).toBe(400)
	})

	it('parse numeric params', async () => {
		const app = new Elysia().get(
			'/test/:id/:id2/:id3',
			({ params }) => params,
			{
				params: t.Object({
					id: t.Numeric(),
					id2: t.Optional(t.Numeric()),
					id3: t.String()
				})
			}
		)

		const res = await app.handle(req('/test/1/2/3')).then((x) => x.json())

		expect(res).toEqual({
			id: 1,
			id2: 2,
			id3: '3'
		})
	})
})
