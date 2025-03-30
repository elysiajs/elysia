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
		const app = new Elysia()
			.guard({
				response: t.Object({ name: t.Literal('cantarella') })
			})
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() })
			})
			.post('/name/:name', ({ body }) => body, {
				response: t.Object(
					{ id: t.Number() },
					{
						additionalProperties: false
					}
				)
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

	// it('override additionalProperties while merging guards', async () => {
	// 	const app = new Elysia({ normalize: false })
	// 		.guard({
	// 			schema: 'standalone',
	// 			body: t.Object(
	// 				{ id: t.Number() },
	// 				{
	// 					additionalProperties: false
	// 				}
	// 			),
	// 			response: t.Object(
	// 				{ name: t.Literal('cantarella') },
	// 				{
	// 					additionalProperties: false
	// 				}
	// 			)
	// 		})
	// 		.post(
	// 			'/name/:name',
	// 			({ body, params: { name } }) => ({
	// 				...body,
	// 				name: name as 'cantarella',
	// 				b: 'c'
	// 			}),
	// 			{
	// 				body: t.Object({ name: t.Literal('cantarella') }),
	// 				response: t.Object({ id: t.Number() })
	// 			}
	// 		)

	// 	const correct = await app.handle(
	// 		post('/name/cantarella', {
	// 			id: 1,
	// 			name: 'cantarella'
	// 		})
	// 	)

	// 	expect(correct.status).toBe(200)
	// 	expect(await correct.json()).toEqual({ id: 1, name: 'cantarella' })

	// 	const incorrect = await app.handle(
	// 		post('/name/jinhsi', {
	// 			id: 1
	// 		})
	// 	)

	// 	expect(incorrect.status).toBe(422)
	// })
})

// // scoped
// {
// 	// Handle standalone
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			// @ts-expect-error
// 			.post('/', ({ body }) => {
// 				expectTypeOf<typeof body>().toEqualTypeOf<{
// 					id: number
// 				}>()

// 				return {
// 					success: 'a'
// 				}
// 			})
// 	}

// 	// Handle with local schema standalone
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						name: string
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.String() }),
// 					response: t.Object({ name: t.String() })
// 				}
// 			)
// 	}

// 	// Handle with multiple standalone with local schema
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ separated: t.Literal(true) })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						separated: true
// 						name: string
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.String() }),
// 					response: t.Object({ name: t.String() })
// 				}
// 			)
// 	}

// 	// Handle standalone after override guard
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.guard({
// 				as: 'scoped',
// 				body: t.Object({ separated: t.Literal(true) })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						name: 'cantarella'
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.Literal('cantarella') }),
// 					response: t.Object({ id: t.Number() })
// 				}
// 			)
// 	}

// 	// Handle standalone
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			// @ts-expect-error
// 			.post('/', ({ body }) => {
// 				expectTypeOf<typeof body>().toEqualTypeOf<{
// 					id: number
// 				}>()

// 				return {
// 					success: 'a'
// 				}
// 			})
// 	}

// 	// Handle with local schema standalone
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						name: string
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.String() }),
// 					response: t.Object({ name: t.String() })
// 				}
// 			)
// 	}

// 	// Handle with multiple standalone with local schema
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.guard({
// 				schema: 'standalone',
// 				body: t.Object({ separated: t.Literal(true) })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						separated: true
// 						name: string
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.String() }),
// 					response: t.Object({ name: t.String() })
// 				}
// 			)
// 	}

// 	// Handle standalone after override guard
// 	{
// 		const local = new Elysia()
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ separated: t.Literal(true) })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						separated: true
// 						name: 'cantarella'
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.Literal('cantarella') }),
// 					response: t.Object({ id: t.Number() })
// 				}
// 			)

// 		const parent = new Elysia().use(local).post(
// 			'/',
// 			({ body }) => {
// 				expectTypeOf<typeof body>().toEqualTypeOf<{
// 					id: number
// 					separated: true
// 					name: 'cantarella'
// 				}>()

// 				return {
// 					success: true,
// 					id: 1,
// 					name: body.name
// 				}
// 			},
// 			{
// 				body: t.Object({ name: t.Literal('cantarella') }),
// 				response: t.Object({ id: t.Number() })
// 			}
// 		)

// 		const main = new Elysia().use(parent).post(
// 			'/',
// 			({ body }) => {
// 				expectTypeOf<typeof body>().toEqualTypeOf<{
// 					name: 'cantarella'
// 				}>()

// 				return {
// 					id: 1,
// 					name: body.name
// 				}
// 			},
// 			{
// 				body: t.Object({ name: t.Literal('cantarella') }),
// 				response: t.Object({ id: t.Number() })
// 			}
// 		)

// 		const propagated = new Elysia().use(parent.as('scoped')).post(
// 			'/',
// 			({ body }) => {
// 				expectTypeOf<typeof body>().toEqualTypeOf<{
// 					name: 'cantarella'
// 					id: number
// 					separated: true
// 				}>()

// 				return {
// 					success: true,
// 					id: 1,
// 					name: body.name
// 				}
// 			},
// 			{
// 				body: t.Object({ name: t.Literal('cantarella') }),
// 				response: t.Object({ id: t.Number() })
// 			}
// 		)
// 	}
// }

// // global
// {
// 	// Handle standalone
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			// @ts-expect-error
// 			.post('/', ({ body }) => {
// 				expectTypeOf<typeof body>().toEqualTypeOf<{
// 					id: number
// 				}>()

// 				return {
// 					success: 'a'
// 				}
// 			})
// 	}

// 	// Handle with local schema standalone
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						name: string
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.String() }),
// 					response: t.Object({ name: t.String() })
// 				}
// 			)
// 	}

// 	// Handle with multiple standalone with local schema
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ separated: t.Literal(true) })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						separated: true
// 						name: string
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.String() }),
// 					response: t.Object({ name: t.String() })
// 				}
// 			)
// 	}

// 	// Handle standalone after override guard
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.guard({
// 				as: 'global',
// 				body: t.Object({ separated: t.Literal(true) })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						name: 'cantarella'
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.Literal('cantarella') }),
// 					response: t.Object({ id: t.Number() })
// 				}
// 			)
// 	}

// 	// Handle standalone
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			// @ts-expect-error
// 			.post('/', ({ body }) => {
// 				expectTypeOf<typeof body>().toEqualTypeOf<{
// 					id: number
// 				}>()

// 				return {
// 					success: 'a'
// 				}
// 			})
// 	}

// 	// Handle with local schema standalone
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						name: string
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.String() }),
// 					response: t.Object({ name: t.String() })
// 				}
// 			)
// 	}

// 	// Handle with multiple standalone with local schema
// 	{
// 		new Elysia()
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.guard({
// 				as: 'scoped',
// 				schema: 'standalone',
// 				body: t.Object({ separated: t.Literal(true) })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						separated: true
// 						name: string
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.String() }),
// 					response: t.Object({ name: t.String() })
// 				}
// 			)
// 	}

// 	// Handle standalone after override guard
// 	{
// 		const local = new Elysia()
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ id: t.Number() }),
// 				response: t.Object({ success: t.Boolean() })
// 			})
// 			.guard({
// 				as: 'global',
// 				schema: 'standalone',
// 				body: t.Object({ separated: t.Literal(true) })
// 			})
// 			.post(
// 				'/',
// 				({ body }) => {
// 					expectTypeOf<typeof body>().toEqualTypeOf<{
// 						id: number
// 						separated: true
// 						name: 'cantarella'
// 					}>()

// 					return {
// 						success: true,
// 						...body
// 					}
// 				},
// 				{
// 					body: t.Object({ name: t.Literal('cantarella') }),
// 					response: t.Object({ id: t.Number() })
// 				}
// 			)

// 		const parent = new Elysia().use(local).post(
// 			'/',
// 			({ body }) => {
// 				expectTypeOf<typeof body>().toEqualTypeOf<{
// 					id: number
// 					separated: true
// 					name: 'cantarella'
// 				}>()

// 				return {
// 					success: true,
// 					id: 1,
// 					name: body.name
// 				}
// 			},
// 			{
// 				body: t.Object({ name: t.Literal('cantarella') }),
// 				response: t.Object({ id: t.Number() })
// 			}
// 		)

// 		const main = new Elysia().use(parent).post(
// 			'/',
// 			({ body }) => {
// 				expectTypeOf<typeof body>().toEqualTypeOf<{
// 					name: 'cantarella'
// 					separated: true
// 					id: number
// 				}>()

// 				return {
// 					success: true,
// 					id: 1,
// 					name: body.name
// 				}
// 			},
// 			{
// 				body: t.Object({ name: t.Literal('cantarella') }),
// 				response: t.Object({ id: t.Number() })
// 			}
// 		)
// 	}
// }
