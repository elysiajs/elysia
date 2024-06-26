import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { post, req } from '../utils'

describe('Normalize', () => {
	it('normalize response', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Object({
					hello: t.String()
				})
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'world'
		})
	})

	it('normalize optional response', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Optional(
					t.Object({
						hello: t.String()
					})
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'world'
		})
	})

	it('strictly validate response if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Object({
					hello: t.String()
				})
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toEqual(422)
	})

	it('normalize multiple response', async () => {
		const app = new Elysia().get(
			'/',
			({ error }) => error(418, { name: 'Nagisa', hifumi: 'daisuki' }),
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			name: 'Nagisa'
		})
	})

	it('strictly validate multiple response', async () => {
		const app = new Elysia({
			normalize: false
		}).get(
			'/',
			({ error }) => error(418, { name: 'Nagisa', hifumi: 'daisuki' }),
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toEqual(422)
	})

	it('normalize multiple response using 200', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					hello: 'Nagisa',
					hifumi: 'daisuki'
				}
			},
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'Nagisa'
		})
	})

	it('strictly validate multiple response using 200 if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			() => {
				return {
					hello: 'Nagisa',
					hifumi: 'daisuki'
				}
			},
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toEqual(422)
	})

	it('do not normalize response when allowing additional properties', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Object(
					{
						hello: t.String()
					},
					{ additionalProperties: true }
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'world',
			a: 'b'
		})
	})

	it('normalize body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String()
			})
		})

		const response = await app
			.handle(
				post('/', {
					name: 'nagisa',
					hifumi: 'daisuki'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('normalize optional body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Optional(
				t.Object({
					name: t.String()
				})
			)
		})

		const response = await app
			.handle(
				post('/', {
					name: 'nagisa',
					hifumi: 'daisuki'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('strictly validate body if not normalize', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			({ body }) => body,
			{
				body: t.Object({
					name: t.String()
				})
			}
		)

		const response = await app.handle(
			post('/', {
				name: 'nagisa',
				hifumi: 'daisuki'
			})
		)

		expect(response.status).toBe(422)
	})

	it('loosely validate body if not normalize and has additionalProperties', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			({ body }) => body,
			{
				body: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: true
					}
				)
			}
		)

		const response = await app.handle(
			post('/', {
				name: 'nagisa',
				hifumi: 'daisuki'
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize query', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String()
			})
		})

		const response = await app
			.handle(req('/?name=nagisa&hifumi=daisuki'))
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it("don't normalize query on additionalProperties", async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object(
				{
					name: t.String()
				},
				{ additionalProperties: true }
			)
		})

		const response = await app
			.handle(req('/?name=nagisa&hifumi=daisuki'))
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize based on property when normalized is disabled', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ query }) => query,
			{
				query: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: true
					}
				)
			}
		)

		const response = await app
			.handle(req('/?name=nagisa&hifumi=daisuki'))
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize headers', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String()
			})
		})

		const response = await app
			.handle(
				req('/', {
					headers: {
						name: 'nagisa',
						hifumi: 'daisuki'
					}
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('loosely validate headers by default if not normalized', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ headers }) => headers,
			{
				headers: t.Object({
					name: t.String()
				})
			}
		)

		const headers = {
			name: 'sucrose',
			job: 'alchemist'
		}
		const res = await app.handle(
			req('/', {
				headers
			})
		)

		expect(await res.json()).toEqual(headers)
		expect(res.status).toBe(200)
	})

	it('strictly validate headers if not normalized and additionalProperties is false', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ headers }) => headers,
			{
				headers: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: false
					}
				)
			}
		)

		const response = await app.handle(
			req('/', {
				headers: {
					name: 'nagisa',
					hifumi: 'daisuki'
				}
			})
		)

		expect(response.status).toBe(422)
	})
})
