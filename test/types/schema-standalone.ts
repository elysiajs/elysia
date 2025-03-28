import { Elysia, t } from '../../src'
import { expectTypeOf } from 'expect-type'

// local
{
	// Handle standalone
	{
		new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			// @ts-expect-error
			.post('/', ({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					id: number
				}>()

				return {
					success: 'a'
				}
			})
	}

	// Handle with local schema standalone
	{
		new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				({ body, headers }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						separated: true
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle standalone after override guard
	{
		new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: 'saltyaom'
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				}
			)
	}

	// Handle standalone
	{
		new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			// @ts-expect-error
			.post('/', ({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					id: number
				}>()

				return {
					success: 'a'
				}
			})
	}

	// Handle with local schema standalone
	{
		new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						separated: true
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle standalone after override guard
	{
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						name: 'saltyaom'
						id: number
						separated: true
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				}
			)

		const main = new Elysia().use(local).post(
			'/',
			({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'saltyaom'
				}>()

				return {
					id: 1,
					name: body.name
				}
			},
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			}
		)
	}
}

// scoped
{
	// Handle standalone
	{
		new Elysia()
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			// @ts-expect-error
			.post('/', ({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					id: number
				}>()

				return {
					success: 'a'
				}
			})
	}

	// Handle with local schema standalone
	{
		new Elysia()
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						separated: true
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle standalone after override guard
	{
		new Elysia()
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				as: 'scoped',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: 'saltyaom'
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				}
			)
	}

	// Handle standalone
	{
		new Elysia()
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			// @ts-expect-error
			.post('/', ({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					id: number
				}>()

				return {
					success: 'a'
				}
			})
	}

	// Handle with local schema standalone
	{
		new Elysia()
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						separated: true
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle standalone after override guard
	{
		const local = new Elysia()
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						separated: true
						name: 'saltyaom'
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				}
			)

		const parent = new Elysia().use(local).post(
			'/',
			({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					id: number
					separated: true
					name: 'saltyaom'
				}>()

				return {
					success: true,
					id: 1,
					name: body.name
				}
			},
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			}
		)

		const main = new Elysia().use(parent).post(
			'/',
			({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'saltyaom'
				}>()

				return {
					id: 1,
					name: body.name
				}
			},
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			}
		)

		const propagated = new Elysia().use(parent.as('scoped')).post(
			'/',
			({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'saltyaom'
					id: number
					separated: true
				}>()

				return {
					success: true,
					id: 1,
					name: body.name
				}
			},
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			}
		)
	}
}

// global
{
	// Handle standalone
	{
		new Elysia()
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			// @ts-expect-error
			.post('/', ({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					id: number
				}>()

				return {
					success: 'a'
				}
			})
	}

	// Handle with local schema standalone
	{
		new Elysia()
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						separated: true
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle standalone after override guard
	{
		new Elysia()
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				as: 'global',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: 'saltyaom'
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				}
			)
	}

	// Handle standalone
	{
		new Elysia()
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			// @ts-expect-error
			.post('/', ({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					id: number
				}>()

				return {
					success: 'a'
				}
			})
	}

	// Handle with local schema standalone
	{
		new Elysia()
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				as: 'scoped',
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						separated: true
						name: string
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				}
			)
	}

	// Handle standalone after override guard
	{
		const local = new Elysia()
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard({
				as: 'global',
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						separated: true
						name: 'saltyaom'
					}>()

					return {
						success: true,
						...body
					}
				},
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				}
			)

		const parent = new Elysia().use(local).post(
			'/',
			({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					id: number
					separated: true
					name: 'saltyaom'
				}>()

				return {
					success: true,
					id: 1,
					name: body.name
				}
			},
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			}
		)

		const main = new Elysia().use(parent).post(
			'/',
			({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'saltyaom'
					separated: true
					id: number
				}>()

				return {
					success: true,
					id: 1,
					name: body.name
				}
			},
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			}
		)
	}
}
