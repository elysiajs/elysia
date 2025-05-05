import { Elysia, t } from '../../src'
import { describe, it, expect } from 'bun:test'
import { post } from '../utils'

describe('standalone validator', () => {
	it('handle guard without local schema', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ name: t.Literal('cantarella') })
			})
			.post('/name/:name', ({ params: { name } }) => ({
				name: name as 'cantarella'
			}))

		const correct = await app.handle(
			post('/name/cantarella', {
				id: 1
			})
		)

		expect(correct.status).toBe(200)
		expect(await correct.json()).toEqual({ name: 'cantarella' })

		const incorrect = await app.handle(
			post('/name/jinhsi', {
				id: 1
			})
		)

		expect(incorrect.status).toBe(422)
	})

	it('merge guard with local schema', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ name: t.Literal('cantarella') })
			})
			.post(
				'/name/:name',
				({ body, params: { name } }) => ({
					...body,
					name: name as 'cantarella'
				}),
				{
					response: t.Object({ id: t.Number() })
				}
			)

		const correct = await app.handle(
			post('/name/cantarella', {
				id: 1
			})
		)

		expect(correct.status).toBe(200)
		expect(await correct.json()).toEqual({ id: 1, name: 'cantarella' })

		const incorrect = await app.handle(
			post('/name/jinhsi', {
				id: 1
			})
		)

		expect(incorrect.status).toBe(422)
	})

	it('merge multiple guard without local schema', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ name: t.Literal('cantarella') })
			})
			.post('/name/:name', ({ params: { name } }) => ({
				name: name as 'cantarella'
			}))

		const correct = await app.handle(
			post('/name/cantarella', {
				id: 1
			})
		)

		expect(correct.status).toBe(200)
		expect(await correct.json()).toEqual({ name: 'cantarella' })

		const incorrect = await app.handle(
			post('/name/jinhsi', {
				id: 1
			})
		)

		expect(incorrect.status).toBe(422)
	})

	it('merge multiple guard with local schema', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				response: t.Object({ name: t.Literal('cantarella') })
			})
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() })
			})
			.post(
				'/name/:name',
				({ body, params: { name } }) => ({
					...body,
					name: name as 'cantarella'
				}),
				{
					response: t.Object({ id: t.Number() })
				}
			)

		const correct = await app.handle(
			post('/name/cantarella', {
				id: 1
			})
		)

		expect(correct.status).toBe(200)
		expect(await correct.json()).toEqual({ id: 1, name: 'cantarella' })

		const incorrect = await app.handle(
			post('/name/jinhsi', {
				id: 1
			})
		)

		expect(incorrect.status).toBe(422)
	})

	it('use override guard when local is not provided', async () => {
		const app = new Elysia()
			.guard({
				response: t.Object(
					{ name: t.Literal('cantarella') },
					{
						additionalProperties: false
					}
				)
			})
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() })
			})
			.post('/name/:name', ({ params: { name } }) => ({
				name: name as 'cantarella'
			}))

		const correct = await app.handle(
			post('/name/cantarella', {
				id: 1
			})
		)

		expect(correct.status).toBe(200)
		expect(await correct.json()).toEqual({ name: 'cantarella' })

		const incorrect = await app.handle(
			post('/name/jinhsi', {
				id: 1
			})
		)

		expect(incorrect.status).toBe(422)
	})

	it('override guard when local is provided', async () => {
		const app = new Elysia({
			normalize: false
		})
			.guard({
				response: t.Object({ name: t.Literal('cantarella') })
			})
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() })
			})
			.post('/name/:name', ({ body }) => body, {
				response: t.Object({ id: t.Number() })
			})

		const correct = await app.handle(
			post('/name/cantarella', {
				id: 1
			})
		)

		expect(correct.status).toBe(200)
		expect(await correct.json()).toEqual({ id: 1 })

		const incorrect = await app.handle(
			post('/name/jinhsi', {
				name: 'cantarella'
			})
		)

		expect(incorrect.status).toBe(422)
	})

	it('merge object guard with additionalProperties via mergeObjectSchemas', async () => {
		const app = new Elysia({
			normalize: false
		})
			.guard({
				schema: 'standalone',
				response: t.Object({ name: t.Literal('cantarella') })
			})
			.guard({
				schema: 'standalone',
				body: t.Object(
					{ id: t.Number() },
					{
						additionalProperties: true
					}
				)
			})
			.post(
				'/name/:name',
				({ body }) => ({
					...body,
					name: 'cantarella'
				}),
				{
					response: t.Object(
						{ id: t.Number() },
						{
							additionalProperties: false
						}
					)
				}
			)

		const correct = await app.handle(
			post('/name/cantarella', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct.status).toBe(200)
		expect(await correct.json()).toEqual({ id: 1, name: 'cantarella' })

		const incorrect = await app.handle(
			post('/name/jinhsi', {
				id: 1,
				familia: 'fisalia',
				a: 'b'
			})
		)

		expect(incorrect.status).toBe(422)
	})

	it('override additionalProperties while merging guards', async () => {
		const app = new Elysia({ normalize: false })
			.guard({
				schema: 'standalone',
				body: t.Object(
					{ id: t.Number() },
					{
						additionalProperties: false
					}
				),
				response: t.Object(
					{ name: t.Literal('cantarella') },
					{
						additionalProperties: false
					}
				)
			})
			.post(
				'/name/:name',
				({ body, params: { name } }) => ({
					...body,
					name: name as 'cantarella'
				}),
				{
					body: t.Object({ name: t.Literal('cantarella') }),
					response: t.Object({ id: t.Number() })
				}
			)

		const correct = await app.handle(
			post('/name/cantarella', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct.status).toBe(200)
		expect(await correct.json()).toEqual({ id: 1, name: 'cantarella' })

		const incorrect = await app.handle(
			post('/name/jinhsi', {
				id: 1,
				family: 'fisalia'
			})
		)

		expect(incorrect.status).toBe(422)
	})

	it('handle local scope', async () => {
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() })
			})
			.post(
				'/local',
				({ body }) => ({
					success: true,
					...body
				}),
				{
					response: t.Object({ success: t.Boolean(), id: t.Number() })
				}
			)

		const app = new Elysia().use(local).post(
			'/main',
			() => ({
				success: true
			}),
			{
				response: t.Object({ success: t.Boolean() })
			}
		)

		const correct1 = await app.handle(
			post('/main', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct1.status).toBe(200)
		expect(await correct1.json()).toEqual({ success: true })

		const correct2 = await app.handle(
			post('/local', {
				id: 1
			})
		)

		expect(correct2.status).toBe(200)
		expect(await correct2.json()).toEqual({ success: true, id: 1 })

		const correct3 = await app.handle(post('/main'))

		expect(correct3.status).toBe(200)
		expect(await correct3.json()).toEqual({ success: true })

		const incorrect1 = await app.handle(
			post('/local', {
				name: 'cantarella'
			})
		)

		expect(incorrect1.status).toBe(422)
	})

	it('handle local scope', async () => {
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() })
			})
			.post(
				'/local',
				({ body }) => ({
					success: true,
					...body
				}),
				{
					response: t.Object({ success: t.Boolean(), id: t.Number() })
				}
			)

		const app = new Elysia().use(local).post(
			'/main',
			() => ({
				success: true
			}),
			{
				response: t.Object({ success: t.Boolean() })
			}
		)

		const correct1 = await app.handle(
			post('/main', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct1.status).toBe(200)
		expect(await correct1.json()).toEqual({ success: true })

		const correct2 = await app.handle(
			post('/local', {
				id: 1
			})
		)

		expect(correct2.status).toBe(200)
		expect(await correct2.json()).toEqual({ success: true, id: 1 })

		const correct3 = await app.handle(post('/main'))

		expect(correct3.status).toBe(200)
		expect(await correct3.json()).toEqual({ success: true })

		const correct4 = await app.handle(
			post('/main', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct4.status).toBe(200)
		expect(await correct4.json()).toEqual({ success: true })

		const incorrect1 = await app.handle(
			post('/local', {
				name: 'cantarella'
			})
		)

		expect(incorrect1.status).toBe(422)
	})

	it('handle local scope with parent schema', async () => {
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() })
			})
			.post(
				'/local',
				({ body }) => ({
					success: true,
					...body
				}),
				{
					response: t.Object({ success: t.Boolean(), id: t.Number() })
				}
			)

		const app = new Elysia()
			.use(local)
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() })
			})
			.post(
				'/main',
				() => ({
					success: true
				}),
				{
					response: t.Object({ success: t.Boolean() })
				}
			)

		const correct1 = await app.handle(
			post('/main', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct1.status).toBe(200)
		expect(await correct1.json()).toEqual({ success: true })

		const correct2 = await app.handle(
			post('/local', {
				id: 1
			})
		)

		expect(correct2.status).toBe(200)
		expect(await correct2.json()).toEqual({ success: true, id: 1 })

		const correct3 = await app.handle(
			post('/main', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct3.status).toBe(200)
		expect(await correct3.json()).toEqual({ success: true })

		const incorrect1 = await app.handle(
			post('/local', {
				name: 'cantarella'
			})
		)

		expect(incorrect1.status).toBe(422)

		const incorrect2 = await app.handle(
			post('/main', {
				name: 'cantarella'
			})
		)

		expect(incorrect2.status).toBe(422)
	})

	it('handle scoped scope', async () => {
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				as: 'scoped',
				body: t.Object({ id: t.Number() })
			})
			.post(
				'/local',
				({ body }) => ({
					success: true,
					...body
				}),
				{
					response: t.Object({ success: t.Boolean(), id: t.Number() })
				}
			)

		const parent = new Elysia().use(local).post(
			'/parent',
			() => ({
				success: true
			}),
			{
				response: t.Object({ success: t.Boolean() })
			}
		)

		const app = new Elysia().use(parent).post(
			'/main',
			() => ({
				success: true
			}),
			{
				response: t.Object({ success: t.Boolean() })
			}
		)

		const correct1 = await app.handle(
			post('/parent', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct1.status).toBe(200)
		expect(await correct1.json()).toEqual({ success: true })

		const correct2 = await app.handle(
			post('/local', {
				id: 1
			})
		)

		expect(correct2.status).toBe(200)
		expect(await correct2.json()).toEqual({ success: true, id: 1 })

		const correct3 = await app.handle(
			post('/parent', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct3.status).toBe(200)
		expect(await correct3.json()).toEqual({ success: true })

		const correct4 = await app.handle(post('/main'))

		expect(correct4.status).toBe(200)
		expect(await correct4.json()).toEqual({ success: true })

		const incorrect1 = await app.handle(
			post('/local', {
				name: 'cantarella'
			})
		)

		expect(incorrect1.status).toBe(422)

		const incorrect2 = await app.handle(
			post('/parent', {
				name: 'cantarella'
			})
		)

		expect(incorrect2.status).toBe(422)
	})

	it('handle global scope', async () => {
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				as: 'global',
				body: t.Object({ id: t.Number() })
			})
			.post(
				'/local',
				({ body }) => ({
					success: true,
					...body
				}),
				{
					response: t.Object({ success: t.Boolean(), id: t.Number() })
				}
			)

		const parent = new Elysia().use(local).post(
			'/parent',
			() => ({
				success: true
			}),
			{
				response: t.Object({ success: t.Boolean() })
			}
		)

		const app = new Elysia().use(parent).post(
			'/main',
			() => ({
				success: true
			}),
			{
				response: t.Object({ success: t.Boolean() })
			}
		)

		const correct1 = await app.handle(
			post('/parent', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct1.status).toBe(200)
		expect(await correct1.json()).toEqual({ success: true })

		const correct2 = await app.handle(
			post('/local', {
				id: 1
			})
		)

		expect(correct2.status).toBe(200)
		expect(await correct2.json()).toEqual({ success: true, id: 1 })

		const correct3 = await app.handle(
			post('/parent', {
				id: 1,
				name: 'cantarella'
			})
		)

		expect(correct3.status).toBe(200)
		expect(await correct3.json()).toEqual({ success: true })

		const incorrect1 = await app.handle(
			post('/local', {
				name: 'cantarella'
			})
		)

		expect(incorrect1.status).toBe(422)

		const incorrect2 = await app.handle(
			post('/parent', {
				name: 'cantarella'
			})
		)
		expect(incorrect2.status).toBe(422)

		const incorrect3 = await app.handle(post('/main'))
		expect(incorrect3.status).toBe(422)
	})

	it('handle every schema type on local scope', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ family: t.String() }),
				headers: t.Object({ family: t.String() }),
				query: t.Object({ family: t.String() }),
				params: t.Object({ family: t.String() }),
				response: t.Object({ family: t.String() }),
				cookie: t.Object({
					family: t.String()
				})
			})
			.post(
				'/:family/:name',
				({ body }) => ({
					...body,
					name: 'cantarella'
				}),
				{
					body: t.Object({ name: t.String() }),
					headers: t.Object({ name: t.String() }),
					query: t.Object({ name: t.String() }),
					params: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() }),
					cookie: t.Object({ name: t.String() })
				}
			)

		const correct = await app.handle(
			new Request(
				'http://localhost:3000/fisalia/cantarella?name=cantarella&family=fisalia',
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						family: 'fisalia',
						name: 'cantarella',
						cookie: 'name=cantarella;family=fisalia'
					},
					body: JSON.stringify({
						family: 'fisalia',
						name: 'cantarella'
					})
				}
			)
		)

		expect(correct.status).toBe(200)
		expect(await correct.json()).toEqual({
			family: 'fisalia',
			name: 'cantarella'
		})

		const incorrect = await app.handle(
			post('/hsi/jinhsi', {
				id: 1
			})
		)

		expect(incorrect.status).toBe(422)
	})

	it('handle every schema type on scoped scope', async () => {
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				as: 'scoped',
				body: t.Object({ family: t.String() }),
				headers: t.Object({ family: t.String() }),
				query: t.Object({ family: t.String() }),
				params: t.Object({ family: t.String() }),
				response: t.Object({ family: t.String() }),
				cookie: t.Object({
					family: t.String()
				})
			})
			.post('/:family', ({ body }) => body)

		const app = new Elysia()
			.use(local)
			.post('/:family/:name', ({ body }) => body, {
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			})

		const correct1 = await app.handle(
			new Request(
				'http://localhost:3000/fisalia/cantarella?name=cantarella&family=fisalia',
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						family: 'fisalia',
						name: 'cantarella',
						cookie: 'name=cantarella;family=fisalia'
					},
					body: JSON.stringify({
						family: 'fisalia',
						name: 'cantarella'
					})
				}
			)
		)

		expect(correct1.status).toBe(200)
		expect(await correct1.json()).toEqual({
			family: 'fisalia',
			name: 'cantarella'
		})

		const correct2 = await app.handle(
			new Request('http://localhost:3000/fisalia?family=fisalia', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					family: 'fisalia',
					cookie: 'name=cantarella;family=fisalia'
				},
				body: JSON.stringify({
					family: 'fisalia'
				})
			})
		)

		expect(correct2.status).toBe(200)
		expect(await correct2.json()).toEqual({
			family: 'fisalia'
		})

		const incorrect1 = await app.handle(
			post('/hsi/jinhsi', {
				id: 1
			})
		)

		expect(incorrect1.status).toBe(422)

		const incorrect2 = await app.handle(
			post('/hsi', {
				id: 1
			})
		)

		expect(incorrect2.status).toBe(422)
	})

	it('handle every schema type on global scope', async () => {
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				as: 'global',
				body: t.Object({ family: t.String() }),
				headers: t.Object({ family: t.String() }),
				query: t.Object({ family: t.String() }),
				params: t.Object({ family: t.String() }),
				response: t.Object({ family: t.String() }),
				cookie: t.Object({ family: t.String() })
			})
			.post('/:family', ({ body }) => body)

		const parent = new Elysia()
			.use(local)
			.post('/family/:family/:name', ({ body }) => body, {
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			})

		const app = new Elysia()
			.use(parent)
			.post('/:family/:name', ({ body }) => body, {
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			})

		const correct1 = await app.handle(
			new Request(
				'http://localhost:3000/fisalia/cantarella?name=cantarella&family=fisalia',
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						family: 'fisalia',
						name: 'cantarella',
						cookie: 'name=cantarella;family=fisalia'
					},
					body: JSON.stringify({
						family: 'fisalia',
						name: 'cantarella'
					})
				}
			)
		)

		expect(correct1.status).toBe(200)
		expect(await correct1.json()).toEqual({
			family: 'fisalia',
			name: 'cantarella'
		})

		const correct2 = await app.handle(
			new Request('http://localhost:3000/fisalia?family=fisalia', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					family: 'fisalia',
					cookie: 'name=cantarella;family=fisalia'
				},
				body: JSON.stringify({
					family: 'fisalia'
				})
			})
		)

		expect(correct2.status).toBe(200)
		expect(await correct2.json()).toEqual({
			family: 'fisalia'
		})

		const correct3 = await app.handle(
			new Request(
				'http://localhost:3000/family/fisalia/cantarella?name=cantarella&family=fisalia',
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						family: 'fisalia',
						name: 'cantarella',
						cookie: 'name=cantarella;family=fisalia'
					},
					body: JSON.stringify({
						family: 'fisalia',
						name: 'cantarella'
					})
				}
			)
		)

		expect(correct3.status).toBe(200)
		expect(await correct3.json()).toEqual({
			family: 'fisalia',
			name: 'cantarella'
		})

		const incorrect1 = await app.handle(
			post('/hsi/jinhsi', {
				id: 1
			})
		)

		expect(incorrect1.status).toBe(422)

		const incorrect2 = await app.handle(
			post('/hsi', {
				id: 1
			})
		)

		expect(incorrect2.status).toBe(422)

		const incorrect3 = await app.handle(
			post('/family/hsi/jinhsi', {
				id: 1
			})
		)

		expect(incorrect3.status).toBe(422)
	})
})
