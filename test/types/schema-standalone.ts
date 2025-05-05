import { Cookie, Elysia, t } from '../../src'
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

// handle every schema type on local
{
	// ? handle local
	{
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				body: t.Object({ family: t.String() }),
				headers: t.Object({ family: t.String() }),
				query: t.Object({ family: t.String() }),
				params: t.Object({ family: t.String() }),
				response: t.Object({ family: t.String() }),
				cookie: t.Object({ family: t.String() })
			})
			.post(
				'/:family',
				({ body, query, params, headers, cookie }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof query>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof params>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof headers>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof cookie>().toEqualTypeOf<
						Record<string, Cookie<string | undefined>> & {
							family: Cookie<string>
							name: Cookie<string>
						}
					>()

					return body
				},
				{
					body: t.Object({ name: t.String() }),
					headers: t.Object({ name: t.String() }),
					query: t.Object({ name: t.String() }),
					params: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() }),
					cookie: t.Object({ name: t.String() })
				}
			)

		const parent = new Elysia().use(local).post(
			'/family/:family/:name',
			({ body, query, params, headers, cookie }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof params>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof headers>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<string | undefined>> & {
						name: Cookie<string>
					}
				>()

				return body
			},
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			}
		)

		const app = new Elysia().use(parent).post(
			'/:family/:name',
			({ body, query, params, headers, cookie }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof params>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof headers>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<string | undefined>> & {
						name: Cookie<string>
					}
				>()

				return body
			},
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			}
		)
	}
}

// handle every schema type on scoped
{
	// ? handle local
	{
		const local = new Elysia()
			.guard({
				schema: 'standalone',
				as: 'scoped',
				body: t.Object({ family: t.String() }),
				headers: t.Object({ family: t.String() }),
				query: t.Object({ family: t.String() }),
				params: t.Object({ family: t.String() }),
				response: t.Object({ family: t.String() }),
				cookie: t.Object({ family: t.String() })
			})
			.post(
				'/:family',
				({ body, query, params, headers, cookie }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof query>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof params>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof headers>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof cookie>().toEqualTypeOf<
						Record<string, Cookie<string | undefined>> & {
							family: Cookie<string>
							name: Cookie<string>
						}
					>()

					return body
				},
				{
					body: t.Object({ name: t.String() }),
					headers: t.Object({ name: t.String() }),
					query: t.Object({ name: t.String() }),
					params: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() }),
					cookie: t.Object({ name: t.String() })
				}
			)

		const parent = new Elysia().use(local).post(
			'/family/:family/:name',
			({ body, query, params, headers, cookie }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof params>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof headers>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<string | undefined>> & {
						family: Cookie<string>
						name: Cookie<string>
					}
				>()

				return body
			},
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			}
		)

		const app = new Elysia().use(parent).post(
			'/:family/:name',
			({ body, query, params, headers, cookie }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof params>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof headers>().toEqualTypeOf<{
					name: string
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<string | undefined>> & {
						name: Cookie<string>
					}
				>()

				return body
			},
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			}
		)
	}
}

// handle every schema type on global
{
	// ? handle local
	{
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
			.post(
				'/:family',
				({ body, query, params, headers, cookie }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof query>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof params>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof headers>().toEqualTypeOf<{
						family: string
						name: string
					}>()

					expectTypeOf<typeof cookie>().toEqualTypeOf<
						Record<string, Cookie<string | undefined>> & {
							family: Cookie<string>
							name: Cookie<string>
						}
					>()

					return body
				},
				{
					body: t.Object({ name: t.String() }),
					headers: t.Object({ name: t.String() }),
					query: t.Object({ name: t.String() }),
					params: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() }),
					cookie: t.Object({ name: t.String() })
				}
			)

		const parent = new Elysia().use(local).post(
			'/family/:family/:name',
			({ body, query, params, headers, cookie }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof params>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof headers>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<string | undefined>> & {
						family: Cookie<string>
						name: Cookie<string>
					}
				>()

				return body
			},
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			}
		)

		const app = new Elysia().use(parent).post(
			'/:family/:name',
			({ body, query, params, headers, cookie }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof params>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof headers>().toEqualTypeOf<{
					family: string
					name: string
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<string | undefined>> & {
						family: Cookie<string>
						name: Cookie<string>
					}
				>()

				return body
			},
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			}
		)
	}
}
