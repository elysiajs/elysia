/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect } from 'bun:test'
import { t, Elysia, RouteSchema, Cookie } from '../../src'
import { expectTypeOf } from 'expect-type'

const app = new Elysia()

// ? default value of context
app.get('/', ({ headers, query, params, body, store }) => {
	// ? default keyof params should be never
	expectTypeOf<typeof params>().toBeNever()

	// ? default headers should be Record<string, unknown>
	expectTypeOf<typeof headers>().toEqualTypeOf<
		Record<string, string | null>
	>()

	// ? default query should be Record<string, unknown>
	expectTypeOf<typeof query>().toEqualTypeOf<Record<string, string | null>>()

	// ? default body should be unknown
	expectTypeOf<typeof body>().toBeUnknown()

	// ? default store should be empty
	expectTypeOf<typeof store>().toEqualTypeOf<{}>()
})

app.model({
	t: t.Object({
		username: t.String(),
		password: t.String()
	})
}).get(
	'/',
	({ headers, query, params, body, cookie }) => {
		// ? unwrap body type
		expectTypeOf<{
			username: string
			password: string
		}>().toEqualTypeOf<typeof body>()

		// ? unwrap body type
		expectTypeOf<{
			username: string
			password: string
		}>().toEqualTypeOf<typeof query>()

		// ? unwrap body type
		expectTypeOf<{
			username: string
			password: string
		}>().toEqualTypeOf<typeof params>()

		// ? unwrap body type
		expectTypeOf<{
			username: string
			password: string
		}>().toEqualTypeOf<typeof headers>()

		// ? unwrap cookie
		expectTypeOf<
			Record<string, Cookie<any>> & {
				username: Cookie<string>
				password: Cookie<string>
			}
		>().toEqualTypeOf<typeof cookie>()

		return body
	},
	{
		body: 't',
		params: 't',
		query: 't',
		headers: 't',
		response: 't',
		cookie: 't'
	}
)

app.get('/id/:id', ({ params }) => {
	// ? infer params name
	expectTypeOf<{
		id: string
	}>().toEqualTypeOf<typeof params>()
})

app.get('/id/:id/name/:name', ({ params }) => {
	// ? infer multiple params name
	expectTypeOf<{
		id: string
		name: string
	}>().toEqualTypeOf<typeof params>()
})

// ? support unioned response
app.get('/', () => '1', {
	response: {
		200: t.String(),
		400: t.Number()
	}
}).get('/', () => 1, {
	response: {
		200: t.String(),
		400: t.Number()
	}
})

// ? support pre-defined schema
app.guard({
	body: t.String()
}).get('/', ({ body }) => {
	expectTypeOf<typeof body>().not.toBeUnknown()
	expectTypeOf<typeof body>().toBeString()
})

// ? override schema
app.guard({
	body: t.String()
}).get(
	'/',
	({ body }) => {
		expectTypeOf<typeof body>().not.toBeUnknown()
		expectTypeOf<typeof body>().toBeNumber()
	},
	{
		body: t.Number()
	}
)

// ? override schema
app.model({
	string: t.String()
}).guard(
	{
		body: t.String()
	},
	(app) =>
		app
			// ? Inherits guard type
			.get('/', ({ body }) => {
				expectTypeOf<typeof body>().not.toBeUnknown()
				expectTypeOf<typeof body>().toBeString()
			})
			// // ? override guard type
			.get(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().not.toBeUnknown()
					expectTypeOf<typeof body>().toBeNumber()
				},
				{
					body: t.Number()
				}
			)
			// ? Merge schema and inherits typed
			.get(
				'/',
				({ body, query }) => {
					expectTypeOf<typeof query>().not.toEqualTypeOf<
						Record<string, unknown>
					>()
					expectTypeOf<typeof query>().toEqualTypeOf<{
						a: string
					}>()

					expectTypeOf<typeof body>().not.toBeUnknown()
					expectTypeOf<typeof body>().toBeString()
				},
				{
					query: t.Object({
						a: t.String()
					})
				}
			)
			// ? Inherits schema reference
			.get(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().not.toBeUnknown()
					expectTypeOf<typeof body>().toEqualTypeOf<string>()
				},
				{
					body: 'string'
				}
			)
			.model({
				authorization: t.Object({
					authorization: t.String()
				})
			})
			// ? Merge inherited schema
			.get(
				'/',
				({ body, headers }) => {
					expectTypeOf<typeof body>().not.toBeUnknown()

					expectTypeOf<typeof headers>().not.toEqualTypeOf<
						Record<string, unknown>
					>()
					expectTypeOf<typeof headers>().toEqualTypeOf<{
						authorization: string
					}>()
				},
				{
					headers: 'authorization'
				}
			)
			.guard(
				{
					headers: 'authorization'
				},
				(app) =>
					// ? To reconcilate multiple level of schema
					app.get('/', ({ body, headers }) => {
						expectTypeOf<typeof body>().not.toBeUnknown()
						expectTypeOf<typeof body>().toEqualTypeOf<string>()

						expectTypeOf<typeof headers>().not.toBeUnknown()
						expectTypeOf<typeof headers>().toEqualTypeOf<{
							authorization: string
						}>()
					})
			)
)

app.state('a', 'b')
	// ? Infer state
	.get('/', ({ store }) => {
		expectTypeOf<typeof store>().toEqualTypeOf<{
			a: string
		}>()
	})
	.state('b', 'c')
	// ? Merge state
	.get('/', ({ store }) => {
		expectTypeOf<typeof store>().toEqualTypeOf<{
			a: string
			b: string
		}>()
	})
	.state({
		c: 'd',
		d: 'e'
	})
	// ? Use multiple state
	.get('/', ({ store }) => {
		expectTypeOf<typeof store>().toEqualTypeOf<{
			a: string
			b: string
			c: string
			d: string
		}>()
	})

app.decorate('a', 'b')
	// ? Infer state
	.get('/', ({ a }) => {
		expectTypeOf<typeof a>().toBeString()
	})
	.decorate('b', 'c')
	// ? Merge state
	.get('/', ({ a, b }) => {
		expectTypeOf<typeof a>().toBeString()
		expectTypeOf<typeof b>().toBeString()
	})
	.decorate({
		c: 'd',
		d: 'e'
	})
	// ? Use multiple decorate
	.get('/', ({ a, b, c, d }) => {
		expectTypeOf<{
			a: typeof a
			b: typeof b
			c: typeof c
			d: typeof d
		}>().toEqualTypeOf<{
			a: 'b'
			b: 'c'
			c: 'd'
			d: 'e'
		}>()
	})

const b = app
	.model('a', t.Literal('a'))
	// ? Infer label model
	.post(
		'/',
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<'a'>()
		},
		{
			body: 'a',
			transform() {}
		}
	)
	// ? Infer multiple model
	.model({
		b: t.Literal('b'),
		c: t.Literal('c')
	})
	.post(
		'/',
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<'b'>()
		},
		{
			body: 'b'
		}
	)

app.derive(({ headers }) => {
	return {
		authorization: headers.authorization as string
	}
})
	.get('/', ({ authorization }) => {
		// ? infers derive type
		expectTypeOf<typeof authorization>().toBeString()
	})
	.decorate('a', 'b')
	.derive(({ a }) => {
		// ? derive from current context
		expectTypeOf<typeof a>().toBeString()

		return {
			b: a
		}
	})
	.get('/', ({ a, b }) => {
		// ? save previous derivation
		expectTypeOf<typeof a>().toBeString()
		// ? derive from context
		expectTypeOf<typeof b>().toBeString()
	})

const plugin = (app: Elysia) =>
	app.decorate('decorate', 'a').state('state', 'a').model({
		string: t.String()
	})

// ? inherits plugin type
app.use(plugin).get(
	'/',
	({ body, decorate, store: { state } }) => {
		expectTypeOf<typeof decorate>().toBeString()
		expectTypeOf<typeof state>().toBeString()
		expectTypeOf<typeof body>().toBeString()
	},
	{
		body: 'string'
	}
)

export const asyncPlugin = async (app: Elysia) =>
	app.decorate('decorate', 'a').state('state', 'a').model({
		string: t.String()
	})

// ? inherits async plugin type
app.use(asyncPlugin).get(
	'/',
	({ body, decorate, store: { state } }) => {
		expectTypeOf<typeof decorate>().toBeString()
		expectTypeOf<typeof state>().toBeString()
		expectTypeOf<typeof body>().toBeString()
	},
	{
		body: 'string'
	}
)

// ? inherits lazy loading plugin type
app.use(import('./plugins')).get(
	'/',
	({ body, decorate, store: { state } }) => {
		expectTypeOf<typeof decorate>().toBeString()
		expectTypeOf<typeof state>().toBeString()
		expectTypeOf<typeof body>().toBeString()
	},
	{
		body: 'string'
	}
)

// ? group inherits type
app.use(plugin).group('/', (app) =>
	app.get(
		'/',
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toBeString()
		},
		{
			body: 'string'
		}
	)
)

// ? guard inherits type
app.use(plugin).guard({}, (app) =>
	app.get(
		'/',
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toBeString()
		},
		{
			body: 'string'
		}
	)
)

// ? guarded group inherits type
app.use(plugin).group(
	'/',
	{
		query: t.Object({
			username: t.String()
		})
	},
	(app) =>
		app.get(
			'/',
			({ query, body, decorate, store: { state } }) => {
				expectTypeOf<typeof query>().toEqualTypeOf<{
					username: string
				}>()
				expectTypeOf<typeof decorate>().toBeString()
				expectTypeOf<typeof state>().toBeString()
				expectTypeOf<typeof body>().toBeString()
			},
			{
				body: 'string'
			}
		)
)

// ? It inherits group type to Eden
{
	const server = app
		.group(
			'/v1',
			{
				query: t.Object({
					name: t.String()
				})
			},
			(app) =>
				app.guard(
					{
						headers: t.Object({
							authorization: t.String()
						})
					},
					(app) =>
						app.get('/a', () => 1, {
							body: t.String()
						})
				)
		)
		.get('/', () => 1)

	type App = (typeof server)['schema']
	type Route = App['/v1/a']['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		headers: {
			authorization: string
		}
		body: string
		query: {
			name: string
		}
		params: unknown
		response: {
			200: number
		}
	}>()
}

// ? It doesn't exposed guard type to external route
{
	const server = app
		.guard(
			{
				query: t.Object({
					name: t.String()
				})
			},
			(app) => app
		)
		.get('/', () => 1)

	type App = (typeof server)['schema']
	type Route = App['/']['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		body: unknown
		params: unknown
		query: unknown
		headers: unknown
		response: {
			200: number
		}
	}>()
}

// ? Register websocket
{
	const server = app.group(
		'/v1',
		{
			query: t.Object({
				name: t.String()
			})
		},
		(app) =>
			app.guard(
				{
					headers: t.Object({
						authorization: t.String()
					})
				},
				(app) =>
					app.ws('/a', {
						message(ws, message) {
							message
						},
						body: t.String()
					})
			)
	)
	type App = (typeof server)['schema']
	type Route = App['/v1/a']['subscribe']
	expectTypeOf<Route>().toEqualTypeOf<{
		headers: {
			authorization: string
		}
		body: string
		query: {
			name: string
		}
		params: unknown
		response: unknown
	}>()
}

// ? Register empty model
{
	const server = app.get('/', () => 'Hello').get('/a', () => 'hi')

	type App = (typeof server)['schema']
	type Route = App['/']['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		body: unknown
		headers: unknown
		query: unknown
		params: unknown
		response: {
			200: string
		}
	}>()
}

// ? Register wildcard as params
app.get('/*', ({ params }) => {
	expectTypeOf<typeof params>().toEqualTypeOf<{
		'*': string
	}>()

	return 'hello'
}).get('/id/:id/*', ({ params }) => {
	expectTypeOf<typeof params>().toEqualTypeOf<{
		id: string
		'*': string
	}>()

	return 'hello'
})

// ? Handle recursive path typing
app.group(
	'/:a',
	{
		beforeHandle({ params, params: { a } }) {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				a: string
			}>()

			return a
		}
	},
	(app) =>
		app
			.get('/', ({ params, params: { a } }) => {
				expectTypeOf<typeof params>().toEqualTypeOf<{
					a: string
				}>()

				return a
			})
			.group('/:b', (app) =>
				app.get('/', ({ params, params: { a, b } }) => {
					expectTypeOf<typeof params>().toEqualTypeOf<{
						a: string
						b: string
					}>()

					return b
				})
			)
			.group(
				'/:c',
				{
					beforeHandle({ params, params: { a, c } }) {
						expectTypeOf<typeof params>().toEqualTypeOf<{
							a: string
							c: string
						}>()

						return a
					}
				},
				(app) =>
					app.get('/', ({ params, params: { a, c } }) => {
						expectTypeOf<typeof params>().toEqualTypeOf<{
							a: string
							c: string
						}>()

						return c
					})
			)
)

// ? Handle recursive schema collision causing infinite type
app.group(
	'/:a',
	{
		body: t.Object({
			username: t.String()
		}),
		query: t.Object({
			user: t.String()
		}),
		beforeHandle: ({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<{
				username: string
			}>()
		}
	},
	(app) =>
		app.group(
			'/:c',
			{
				beforeHandle({ body, query }) {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						password: string
					}>()

					expectTypeOf<typeof query>().toEqualTypeOf<{
						user: string
					}>()

					return body
				},
				body: t.Object({
					password: t.String()
				})
			},
			(app) =>
				app.get('/', ({ body }) => {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						password: string
					}>()

					return body
				})
		)
)

// ? Reconcilation on state
// {
// 	const a = app.state('a', 'a' as const)
// 	const b = a.state('a', 'b' as const)

// 	expectTypeOf<(typeof a)['store']>().toEqualTypeOf<{
// 		a: 'a'
// 	}>()

// 	expectTypeOf<(typeof b)['store']>().toEqualTypeOf<{
// 		a: 'b'
// 	}>()
// }

// // ? Reconcilation on decorator
// {
// 	const a = app.decorate('a', 'a' as const)
// 	const b = a.decorate('a', 'b' as const)

// 	expectTypeOf<(typeof a)['decorators']>().toEqualTypeOf<{
// 		a: 'a'
// 	}>()

// 	expectTypeOf<(typeof b)['decorators']>().toEqualTypeOf<{
// 		a: 'b'
// 	}>()
// }

// // ? Reconcilation on model
// {
// 	const a = app.model('a', t.String())
// 	const b = a.model('a', t.Number())

// 	expectTypeOf<(typeof a)['definitions']['type']>().toEqualTypeOf<{
// 		a: string
// 	}>()

// 	expectTypeOf<(typeof b)['definitions']['type']>().toEqualTypeOf<{
// 		a: number
// 	}>()
// }

// // ? Reconcilation on use
// {
// 	const a = app
// 		.state('a', 'a' as const)
// 		.model('a', t.String())
// 		.decorate('a', 'b' as const)
// 		.use((app) =>
// 			app
// 				.state('a', 'b' as const)
// 				.model('a', t.Number())
// 				.decorate('a', 'b' as const)
// 		)

// 	expectTypeOf<(typeof a)['store']>().toEqualTypeOf<{
// 		a: 'b'
// 	}>()

// 	expectTypeOf<(typeof a)['decorators']>().toEqualTypeOf<{
// 		a: 'b'
// 	}>()

// 	expectTypeOf<(typeof a)['definitions']['type']>().toEqualTypeOf<{
// 		a: number
// 	}>()
// }

// ? Inherits plugin instance path
{
	const plugin = new Elysia().get('/', () => 'hello')

	const server = app.use(plugin)

	type App = (typeof server)['schema']
	type Route = App['/']['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		body: unknown
		headers: unknown
		query: unknown
		params: unknown
		response: {
			200: string
		}
	}>()
}

// ? Inherits plugin prefix path
{
	const plugin = new Elysia({
		prefix: '/plugin'
	}).get('/test-path', () => 'Test')

	const app = new Elysia({
		prefix: '/api'
	})
		.use(plugin)
		.get('/a', () => 'A')
		.listen(3000)

	type Routes = keyof (typeof app)['schema']

	expectTypeOf<Routes>().toEqualTypeOf<'/api/a' | '/api/plugin/test-path'>()
}

// ? Inherits plugin instance prefix
{
	const plugin = new Elysia({
		prefix: '/v1'
	}).get('/', () => 'hello')

	plugin.config.prefix

	const server = app.use(plugin)

	type App = (typeof server)['schema']
	type Route = App['/v1/']['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		body: unknown
		headers: unknown
		query: unknown
		params: unknown
		response: {
			200: string
		}
	}>()
}

// ? Inlining function callback don't repeat prefix
{
	const test = (app: Elysia) =>
		app.group('/app', (group) =>
			group.get('/test', async () => {
				return 'Test'
			})
		)

	const app = new Elysia().use(test)

	type App = (typeof app)['schema']
	type Routes = keyof App

	expectTypeOf<Routes>().toEqualTypeOf<'/app/test'>()
}

// ? Merging identical plugin type
{
	const cookie = new Elysia({
		name: 'cookie'
	}).derive(() => {
		return {
			cookie: 'A'
		}
	})

	const controller = new Elysia().use(cookie).get('/', () => 'A')

	const app = new Elysia()
		.use(cookie)
		.use(controller)
		.get('/', ({ cookie }) => {
			expectTypeOf<typeof cookie>().toBeString()
		})
}

// ? Prefer local schema over parent schema for nesting
{
	new Elysia().group(
		'/id/:id',
		{
			params: t.Object({
				id: t.Numeric()
			}),
			beforeHandle({ params }) {
				expectTypeOf<typeof params>().toEqualTypeOf<{
					id: number
				}>()
			}
		},
		(app) =>
			app
				.get('/awd', ({ params }) => {
					expectTypeOf<typeof params>().toEqualTypeOf<{
						id: number
					}>()
				})
				.group(
					'/name/:name',
					{
						params: t.Object({
							id: t.Numeric(),
							name: t.String()
						})
					},
					(app) =>
						app.get('/awd', ({ params }) => {
							expectTypeOf<typeof params>().toEqualTypeOf<{
								id: number
								name: string
							}>()
						})
				)
	)
}
