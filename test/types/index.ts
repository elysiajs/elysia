/* eslint-disable @typescript-eslint/no-unused-vars */
import { t, Elysia } from '../../src'
import { expectTypeOf } from 'expect-type'

const app = new Elysia()

// ? default value of context
app.get('/', ({ headers, query, params, body, store }) => {
	// ? default keyof params should be never
	expectTypeOf<keyof typeof params>().toBeNever()

	// ? default headers should be Record<string, unknown>
	expectTypeOf<typeof headers>().toEqualTypeOf<Record<string, unknown>>()

	// ? default query should be Record<string, unknown>
	expectTypeOf<typeof query>().toEqualTypeOf<Record<string, unknown>>()

	// ? default body should be unknown
	expectTypeOf<typeof body>().toBeUnknown()

	// ? default store should be empty
	expectTypeOf<typeof store>().toEqualTypeOf<{}>()
})

app.setModel({
	t: t.Object({
		username: t.String(),
		password: t.String()
	})
}).get(
	'/',
	({ headers, query, params, body }) => {
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

		return body
	},
	{
		schema: {
			body: 't',
			params: 't',
			query: 't',
			headers: 't',
			response: 't'
		}
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
	schema: {
		response: {
			200: t.String(),
			400: t.Number()
		}
	}
}).get('/', () => 1, {
	schema: {
		response: {
			200: t.String(),
			400: t.Number()
		}
	}
})

// ? support pre-defined schema
app.schema({
	body: t.String()
}).get('/', ({ body }) => {
	expectTypeOf<typeof body>().not.toBeUnknown()
	expectTypeOf<typeof body>().toBeString()
})

// ? override schema
app.schema({
	body: t.String()
}).get(
	'/',
	({ body }) => {
		expectTypeOf<typeof body>().not.toBeUnknown()
		expectTypeOf<typeof body>().toBeNumber()
	},
	{
		schema: {
			body: t.Number()
		}
	}
)

// ? override schema
app.setModel({
	string: t.String()
}).guard(
	{
		schema: {
			body: t.String()
		}
	},
	(app) =>
		app
			// ? Inherits guard type
			.get('/', ({ body }) => {
				expectTypeOf<typeof body>().not.toBeUnknown()
				expectTypeOf<typeof body>().toBeString()
			})
			// ? override guard type
			.get(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().not.toBeUnknown()
					expectTypeOf<typeof body>().toBeNumber()
				},
				{
					schema: {
						body: t.Number()
					}
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
					schema: {
						query: t.Object({
							a: t.String()
						})
					}
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
					schema: {
						body: 'string'
					}
				}
			)
			.setModel({
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
					schema: {
						headers: 'authorization',
						body: 'number'
					}
				}
			)
			.guard(
				{
					schema: {
						headers: 'authorization'
					}
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
	app.decorate('decorate', 'a').state('state', 'a').setModel({
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
		schema: {
			body: 'string'
		}
	}
)

export const asyncPlugin = async (app: Elysia) =>
	app.decorate('decorate', 'a').state('state', 'a').setModel({
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
		schema: {
			body: 'string'
		}
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
		schema: {
			body: 'string'
		}
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
			schema: {
				body: 'string'
			}
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
			schema: {
				body: 'string'
			}
		}
	)
)

// ? guarded group inherits type
app.use(plugin).group(
	'/',
	{
		schema: {
			query: t.Object({
				username: t.String()
			})
		}
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
				schema: {
					body: 'string'
				}
			}
		)
)
