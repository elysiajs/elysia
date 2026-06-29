import { Elysia, t } from '../../src'
import { expectTypeOf } from 'expect-type'
import { Cookie } from '../../src/cookie'

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
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
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
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
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
				}
			)
	}

	// Handle standalone after override guard — the override guard's body is
	// replaced by the route-local one (closer wins); the standalone body still
	// intersects
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
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				},
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: 'saltyaom'
					}>()

					return {
						success: true,
						...body
					}
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
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
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
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
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
				}
			)
	}

	// Handle standalone after override guard — the override guard's body is
	// replaced by the route-local one (closer wins); the standalone body still
	// intersects
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
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				},
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
				}
			)

		const main = new Elysia().use(local).post(
			'/',
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			},
			({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'saltyaom'
				}>()

				return {
					id: 1,
					name: body.name
				}
			}
		)
	}
}

// scoped
{
	// Handle standalone
	{
		new Elysia()
			.guard('plugin', {
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
			.guard('plugin', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard('plugin', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard('plugin', {
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
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
				}
			)
	}

	// Handle standalone after override guard — the override guard's body is
	// replaced by the route-local one (closer wins); the standalone body still
	// intersects
	{
		new Elysia()
			.guard('plugin', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard('plugin', {
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				},
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: 'saltyaom'
					}>()

					return {
						success: true,
						...body
					}
				}
			)
	}

	// Handle standalone
	{
		new Elysia()
			.guard('plugin', {
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
			.guard('plugin', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard('plugin', {
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
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
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
				}
			)
	}

	// Handle standalone after override guard — the override guard's body is
	// replaced by the route-local one (closer wins); the standalone body still
	// intersects
	{
		const local = new Elysia()
			.guard('plugin', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard('plugin', {
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				},
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
				}
			)

		const parent = new Elysia().use(local).post(
			'/',
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			},
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
			}
		)

		const main = new Elysia().use(parent).post(
			'/',
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			},
			({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'saltyaom'
				}>()

				return {
					id: 1,
					name: body.name
				}
			}
		)

		const propagated = new Elysia().use(parent.as('plugin')).post(
			'/',
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			},
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
			}
		)
	}
}

// global
{
	// Handle standalone
	{
		new Elysia()
			.guard('global', {
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
			.guard('global', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard('global', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard('global', {
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
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
				}
			)
	}

	// Handle standalone after override guard — the override guard's body is
	// replaced by the route-local one (closer wins); the standalone body still
	// intersects
	{
		new Elysia()
			.guard('global', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard('global', {
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				},
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: 'saltyaom'
					}>()

					return {
						success: true,
						...body
					}
				}
			)
	}

	// Handle standalone
	{
		new Elysia()
			.guard('global', {
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
			.guard('global', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
				({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						id: number
						name: string
					}>()

					return {
						success: true,
						...body
					}
				}
			)
	}

	// Handle with multiple standalone with local schema
	{
		new Elysia()
			.guard('global', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard('plugin', {
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() })
				},
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
				}
			)
	}

	// Handle standalone after override guard — the override guard's body is
	// replaced by the route-local one (closer wins); the standalone body still
	// intersects
	{
		const local = new Elysia()
			.guard('global', {
				schema: 'standalone',
				body: t.Object({ id: t.Number() }),
				response: t.Object({ success: t.Boolean() })
			})
			.guard('global', {
				schema: 'standalone',
				body: t.Object({ separated: t.Literal(true) })
			})
			.post(
				'/',
				{
					body: t.Object({ name: t.Literal('saltyaom') }),
					response: t.Object({ id: t.Number() })
				},
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
				}
			)

		const parent = new Elysia().use(local).post(
			'/',
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			},
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
			}
		)

		const main = new Elysia().use(parent).post(
			'/',
			{
				body: t.Object({ name: t.Literal('saltyaom') }),
				response: t.Object({ id: t.Number() })
			},
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
				{
					body: t.Object({ name: t.String() }),
					headers: t.Object({ name: t.String() }),
					query: t.Object({ name: t.String() }),
					params: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() }),
					cookie: t.Object({ name: t.String() })
				},
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
						Record<string, Cookie<unknown>> & {
							family: Cookie<string>
							name: Cookie<string>
						}
					>()

					return body
				}
			)

		const parent = new Elysia().use(local).post(
			'/family/:family/:name',
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			},
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
					Record<string, Cookie<unknown>> & {
						name: Cookie<string>
					}
				>()

				return body
			}
		)

		const app = new Elysia().use(parent).post(
			'/:family/:name',
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			},
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
					Record<string, Cookie<unknown>> & {
						name: Cookie<string>
					}
				>()

				return body
			}
		)
	}
}

// handle every schema type on scoped
{
	// ? handle local
	{
		const local = new Elysia()
			.guard('plugin', {
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
				{
					body: t.Object({ name: t.String() }),
					headers: t.Object({ name: t.String() }),
					query: t.Object({ name: t.String() }),
					params: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() }),
					cookie: t.Object({ name: t.String() })
				},
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
						Record<string, Cookie<unknown>> & {
							family: Cookie<string>
							name: Cookie<string>
						}
					>()

					return body
				}
			)

		const parent = new Elysia().use(local).post(
			'/family/:family/:name',
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			},
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
					Record<string, Cookie<unknown>> & {
						family: Cookie<string>
						name: Cookie<string>
					}
				>()

				return body
			}
		)

		const app = new Elysia().use(parent).post(
			'/:family/:name',
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			},
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
					Record<string, Cookie<unknown>> & {
						name: Cookie<string>
					}
				>()

				return body
			}
		)
	}
}

// handle every schema type on global
{
	// ? handle local
	{
		const local = new Elysia()
			.guard('global', {
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
				{
					body: t.Object({ name: t.String() }),
					headers: t.Object({ name: t.String() }),
					query: t.Object({ name: t.String() }),
					params: t.Object({ name: t.String() }),
					response: t.Object({ name: t.String() }),
					cookie: t.Object({ name: t.String() })
				},
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
						Record<string, Cookie<unknown>> & {
							family: Cookie<string>
							name: Cookie<string>
						}
					>()

					return body
				}
			)

		const parent = new Elysia().use(local).post(
			'/family/:family/:name',
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			},
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
					Record<string, Cookie<unknown>> & {
						family: Cookie<string>
						name: Cookie<string>
					}
				>()

				return body
			}
		)

		const app = new Elysia().use(parent).post(
			'/:family/:name',
			{
				body: t.Object({ name: t.String() }),
				headers: t.Object({ name: t.String() }),
				query: t.Object({ name: t.String() }),
				params: t.Object({ name: t.String() }),
				response: t.Object({ name: t.String() }),
				cookie: t.Object({ name: t.String() })
			},
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
					Record<string, Cookie<unknown>> & {
						family: Cookie<string>
						name: Cookie<string>
					}
				>()

				return body
			}
		)
	}
}
