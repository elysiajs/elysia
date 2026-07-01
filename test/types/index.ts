/* eslint-disable @typescript-eslint/no-unused-vars */

import {
	Elysia,
	file,
	form,
	sse,
	status,
	t
} from '../../src'

import { expectTypeOf } from 'expect-type'
import { Cookie } from '../../src/cookie'

const app = new Elysia()

// ? default value of context
app.get('/', ({ headers, query, params, body, store }) => {
	// ? default keyof params should be never
	expectTypeOf<typeof params>().toEqualTypeOf<{}>()

	// ? default headers should be Record<string, unknown>
	expectTypeOf<typeof headers>().toEqualTypeOf<
		Record<string, string | undefined>
	>()

	// ? default query should be Record<string, string>
	expectTypeOf<typeof query>().toEqualTypeOf<Record<string, string>>()

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
	{
		body: 't',
		params: 't',
		query: 't',
		headers: 't',
		response: 't',
		cookie: 't'
	},
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
			Record<string, Cookie<unknown>> & {
				username: Cookie<string>
				password: Cookie<string>
			}
		>().toEqualTypeOf<typeof cookie>()

		return body
	}
)

app.model({
	t: t.Object({
		username: t.String(),
		password: t.String()
	})
}).get(
	'/',
	{
		body: 't',
		response: 't'
	},
	({ body }) => {
		// ? unwrap body type
		expectTypeOf<{
			username: string
			password: string
		}>().toEqualTypeOf<typeof body>()

		return body
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
app.get(
	'/',
	{
		response: {
			200: t.String(),
			400: t.Number()
		}
	},
	() => '1'
).get(
	'/',
	{
		response: {
			200: t.String(),
			400: t.Number()
		}
	},
	() => 1
)

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
	{
		body: t.Number()
	},
	({ body }) => {
		expectTypeOf<typeof body>().not.toBeUnknown()
		expectTypeOf<typeof body>().toBeNumber()
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
				{
					body: t.Number()
				},
				({ body }) => {
					expectTypeOf<typeof body>().not.toBeUnknown()
					expectTypeOf<typeof body>().toBeNumber()
				}
			)
			// ? Merge schema and inherits typed
			.get(
				'/',
				{
					query: t.Object({
						a: t.String()
					})
				},
				({ body, query }) => {
					expectTypeOf<typeof query>().not.toEqualTypeOf<
						Record<string, unknown>
					>()
					expectTypeOf<typeof query>().toEqualTypeOf<{
						a: string
					}>()

					expectTypeOf<typeof body>().not.toBeUnknown()
					expectTypeOf<typeof body>().toBeString()
				}
			)
			// ? Inherits schema reference
			.get(
				'/',
				{
					body: 'string'
				},
				({ body }) => {
					expectTypeOf<typeof body>().not.toBeUnknown()
					expectTypeOf<typeof body>().toEqualTypeOf<string>()
				}
			)
			.get(
				'/',
				{
					body: 'string'
				},
				({ body }) => {
					expectTypeOf<typeof body>().not.toBeUnknown()
					expectTypeOf<typeof body>().toEqualTypeOf<string>()
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
				{
					headers: 'authorization'
				},
				({ body, headers }) => {
					expectTypeOf<typeof body>().not.toBeUnknown()

					expectTypeOf<typeof headers>().not.toEqualTypeOf<
						Record<string, unknown>
					>()
					expectTypeOf<typeof headers>().toEqualTypeOf<{
						authorization: string
					}>()
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
			a: string
			b: string
			c: string
			d: string
		}>()
	})

// ? Reconcile deep using name
{
	const app = new Elysia()
		.decorate('a', {
			hello: {
				world: 'Tako'
			}
		})
		.decorate('a', {
			hello: {
				world: 'Ina',
				cookie: 'wah!'
			}
		})

	expectTypeOf<(typeof app)['~Singleton']['decorator']['a']>().toEqualTypeOf<
		{
			hello: {
				world: string
			}
		} & {
			hello: {
				world: string
				cookie: string
			}
		}
	>()
}

// ? Reconcile deep using value
{
	const app = new Elysia()
		.decorate({
			hello: {
				world: 'Tako'
			}
		})
		.decorate('override', {
			hello: {
				world: 'Ina',
				cookie: 'wah!'
			}
		})

	expectTypeOf<
		(typeof app)['~Singleton']['decorator']['hello']
	>().toEqualTypeOf<{
		world: string
		cookie: string
	}>()
}

// ? Reconcile deep using name
{
	const app = new Elysia()
		.state('a', {
			hello: {
				world: 'Tako'
			}
		})
		.state('a', {
			hello: {
				world: 'Ina',
				cookie: 'wah!'
			}
		})

	expectTypeOf<(typeof app)['~Singleton']['store']['a']>().toEqualTypeOf<
		{
			hello: {
				world: string
			}
		} & {
			hello: {
				world: string
				cookie: string
			}
		}
	>()
}

// ? Reconcile deep using value
{
	const app = new Elysia()
		.state({
			hello: {
				world: 'Tako'
			}
		})
		.state('override', {
			hello: {
				world: 'Ina',
				cookie: 'wah!'
			}
		})

	expectTypeOf<(typeof app)['~Singleton']['store']['hello']>().toEqualTypeOf<{
		world: string
		cookie: string
	}>()
}

const b = app
	.model('a', t.Literal('a'))
	// ? Infer label model
	.post(
		'/',
		{
			body: 'a',
			transform() {}
		},
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<'a'>()
		}
	)
	// ? Infer multiple model
	.model({
		b: t.Literal('b'),
		c: t.Literal('c')
	})
	.post(
		'/',
		{
			body: 'b'
		},
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<'b'>()
		}
	)
	.post(
		'/',
		{
			body: 'c'
		},
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<'c'>()
		}
	)

// ? It derive void
{
	app.derive(({ headers }) => {
		if (Math.random() > 0.5)
			return {
				stuff: 'a'
			}
	}).get('/', ({ stuff }) => {
		expectTypeOf<typeof stuff>().not.toBeUnknown()
		expectTypeOf<typeof stuff>().toEqualTypeOf<'a' | undefined>()
	})
}

// ? It resolve void
{
	app.derive(async ({ headers }) => {
		if (Math.random() > 0.5)
			return {
				stuff: 'a'
			}
	}).get('/', ({ stuff }) => {
		expectTypeOf<typeof stuff>().not.toBeUnknown()
		expectTypeOf<typeof stuff>().toEqualTypeOf<'a' | undefined>()
	})
}

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
	// ? Resolve should not include in onRequest
	.request((context) => {
		expectTypeOf<
			'b' extends keyof typeof context ? true : false
		>().toEqualTypeOf<false>()
	})
	// ? Resolve should not include in onTransform
	.transform((context) => {
		expectTypeOf<
			'b' extends keyof typeof context ? true : false
		>().toEqualTypeOf<true>()
	})

const plugin = (app: Elysia) =>
	app.decorate('decorate', 'a').state('state', 'a').model({
		string: t.String()
	})

// ? inherits plugin type
app.use(plugin)
	.get(
		'/',
		{
			body: 'string'
		},
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toBeString()
		}
	)
	.get(
		'/',
		{
			body: 'string'
		},
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toEqualTypeOf<string>()
		}
	)

export const asyncPlugin = async (app: Elysia) =>
	app.decorate('decorate', 'a').state('state', 'a').model({
		string: t.String()
	})

// ? group inherits type
app.use(plugin).group('/', (app) =>
	app.get(
		'/',
		{
			body: 'string'
		},
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toBeString()
		}
	)
)

// ? guard inherits type
app.use(plugin).guard({}, (app) =>
	app.get(
		'/',
		{
			body: 'string'
		},
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toBeString()
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
	(app) => {
		app['~Metadata'].schema

		return app.get(
			'/',
			{
				body: 'string'
			},
			({ query, body, decorate, store: { state } }) => {
				expectTypeOf<typeof query>().toEqualTypeOf<{
					username: string
				}>()
				expectTypeOf<typeof decorate>().toBeString()
				expectTypeOf<typeof state>().toBeString()
				expectTypeOf<typeof body>().toBeString()
			}
		)
	}
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
						app.get(
							'/a',
							{
								body: t.String()
							},
							() => 1
						)
				)
		)
		.get('/', () => 1)

	type App = (typeof server)['~Routes']
	type Route = App['v1']['a']['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		error: never
		headers: {
			authorization: string
		}
		body: string
		query: {
			name: string
		}
		params: Record<never, string>
		response: {
			200: number
			422: {
				type: 'validation'
				title: 'Validation Error'
				status: 422
				detail?: string
				on: string
				found?: unknown
				property?: string
				expected?: string
			}
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

	type App = (typeof server)['~Routes']
	type Route = App['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		error: never
		body: unknown
		params: {}
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

							ws.params
						},
						body: t.String()
					})
			)
	)
	type App = (typeof server)['~Routes']
	type Route = App['v1']['a']['subscribe']
	expectTypeOf<Route>().toEqualTypeOf<{
		body: string
		params: {}
		query: {
			name: string
		}
		headers: {
			authorization: string
		}
		response: {
			422: {
				type: 'validation'
				title: 'Validation Error'
				status: 422
				detail?: string
				on: string
				found?: unknown
				property?: string
				expected?: string
			}
		}
	}>()
}

// ? Register empty model
{
	const server = app.get('/', () => 'Hello').get('/a', () => 'hi')

	type App = (typeof server)['~Routes']
	type Route = App['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		error: never
		body: unknown
		params: {}
		query: unknown
		headers: unknown
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
		body: t.Object({}),
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
		schema: 'standalone',
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
				schema: 'standalone',
				beforeHandle({ body, query }) {
					expectTypeOf<typeof body>().toEqualTypeOf<{
						username: string
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
						username: string
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

	type App = (typeof server)['~Routes']
	type Route = App['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		error: never
		body: unknown
		params: {}
		query: unknown
		headers: unknown
		response: {
			200: string
		}
	}>()
}

// ? Inherits plugin instance prefix path
{
	const pluginPrefixApp = new Elysia({ prefix: '/app' }).get(
		'/test',
		() => 'hello'
	)

	const appWithArrayOfPlugin = new Elysia({ prefix: '/api' }).use([
		pluginPrefixApp
	])
	const appWithPlugin = new Elysia({ prefix: '/api' }).use(pluginPrefixApp)

	expectTypeOf<(typeof appWithArrayOfPlugin)['~Routes']>().toEqualTypeOf<{
		api: {
			app: {
				test: {
					get: {
						body: unknown
						params: {}
						query: unknown
						headers: unknown
						response: {
							200: string
						}
						error: never
					}
				}
			}
		}
	}>()
	expectTypeOf<(typeof appWithArrayOfPlugin)['~Routes']>().toEqualTypeOf<
		(typeof appWithPlugin)['~Routes']
	>()
}

// ? Inlining function callback don't repeat prefix
{
	const test = (app: Elysia) =>
		app.group('/app', (group) => group.get('/test', () => 'test'))

	const app = new Elysia().use(test)

	type App = (typeof app)['~Routes']
	type Routes = keyof App['app']['test']['get']

	expectTypeOf<Routes>().not.toBeUnknown()
}

// ? Merging identical plugin type
{
	const cookie = new Elysia({
		prefix: '/'
	}).derive('global', () => {
		return {
			customCookie: 'A'
		}
	})

	const controller = new Elysia().use(cookie).get('/', () => 'A')

	const app = new Elysia()
		.use(cookie)
		.use(controller)
		.get('/', ({ customCookie }) => {
			expectTypeOf<typeof customCookie>().toBeString()
		})
}

// ? Prefer local schema over parent schema for nesting
{
	new Elysia().group(
		'/id/:id',
		{
			params: t.Object({
				id: t.Number()
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

// ? Inherits route for scoped instance
{
	const child = new Elysia()
		.decorate('b', 'b')
		.model('b', t.String())
		.get('/child', () => 'Hello from child route')
	const main = new Elysia().use(child)

	type App = (typeof main)['~Routes']

	expectTypeOf<keyof (typeof main)['~Routes']>().toEqualTypeOf<'child'>()
	expectTypeOf<
		keyof (typeof main)['~Singleton']['decorator']
	>().not.toEqualTypeOf<{
		request: {
			b: 'b'
		}
		store: {}
	}>()
	expectTypeOf<keyof (typeof main)['~Definitions']>().not.toEqualTypeOf<{
		type: {
			b: string
		}
		error: []
	}>()
}

// ? WebSocket infers params
{
	new Elysia()
		.ws('/:id', {
			open(ws) {
				expectTypeOf<typeof ws.params>().toEqualTypeOf<{
					id: string
				}>()
			}
		})
		.ws('/:id', {
			params: t.Object({
				id: t.Number()
			}),
			open(ws) {
				expectTypeOf<typeof ws.params>().toEqualTypeOf<{
					id: number
				}>()
			}
		})
}

const a = app
	.derive(({ headers }) => {
		return {
			authorization: headers.authorization as string
		}
	})
	// .get('/', ({ authorization }) => {
	// 	// ? infers derive type
	// 	expectTypeOf<typeof authorization>().toBeString()
	// })
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
	// ? a prior `.derive` runs in the transform stage, so it IS visible here
	.transform((context) => {
		expectTypeOf<
			'b' extends keyof typeof context ? true : false
		>().toEqualTypeOf<true>()
	})
	// ? Resolve should not include in onBeforeHandle
	.beforeHandle((context) => {
		expectTypeOf<
			'b' extends keyof typeof context ? true : false
		>().toEqualTypeOf<true>()
	})

{
	app.macro({
		a(a: string) {}
	})
		.get(
			'/',
			{
				// ? Should contains macro
				a: 'a'
			},
			() => {}
		)
		.get(
			'/',
			// ? Should have error
			{
				// @ts-expect-error
				a: 1
			},
			() => {}
		)
		.macro({
			b(a: number) {}
		})
		.get(
			'/',
			{
				// ? Should merge macro
				a: 'a',
				b: 2
			},
			() => {}
		)
		.guard(
			{
				// ? Should contains macro
				a: 'a',
				b: 2
			},
			(app) =>
				app.get(
					'/',
					{
						// ? Should contains macro
						a: 'a',
						b: 2
					},
					() => {}
				)
		)
}

// ? Join Eden path correctly
{
	const testController = new Elysia({
		name: 'testController',
		prefix: '/test'
	})
		.get('/could-be-error/right', () => ({ couldBeError: true }))
		.ws('/deep/ws', {
			message() {}
		})

	const app = new Elysia().group('/api', (app) => app.use(testController))

	expectTypeOf<
		(typeof app)['~Routes']['api']['test']['could-be-error']['right']['get']
	>().toEqualTypeOf<{
		error: never
		body: unknown
		params: {}
		query: unknown
		headers: unknown
		response: {
			200: {
				couldBeError: boolean
			}
		}
	}>()

	expectTypeOf<
		(typeof app)['~Routes']['api']['test']['deep']['ws']['subscribe']
	>().toEqualTypeOf<{
		body: unknown
		params: {}
		query: unknown
		headers: unknown
		response: {}
	}>()
}

// ? Handle error status
{
	const a = new Elysia()
		.get(
			'/',
			{
				response: {
					200: t.String(),
					418: t.Literal('a')
				}
			},
			({ status }) => status(418, 'a')
		)
		.get(
			'/',
			{
				response: {
					200: t.String(),
					418: t.Literal('a')
				}
			},
			({ status }) => status(418, 'b' as any)
		)
}

// ? Get response type correctly
{
	const app = new Elysia()
		.get('', () => 'a')
		.get('/true', () => true)
		.post('', { response: { 201: t.String() } }, () => 'a')
		.post('/true', { response: { 202: t.Boolean() } }, () => true)
		.get('/error', ({ status }) => status("I'm a teapot", 'a'))
		.post('/mirror', ({ body }) => body)
		.get('/immutable', '1')
		.get('/immutable-error', ({ status }) => status("I'm a teapot", 'a'))
		.get('/async', async ({ status }) => {
			if (Math.random() > 0.5) return status("I'm a teapot", 'Nagisa')

			return 'Hifumi'
		})
		.get('/default-error-code', ({ status }) => {
			if (Math.random() > 0.5) return status(418, 'Nagisa')
			if (Math.random() > 0.5) return status(401)

			return 'Hifumi'
		})

	type app = (typeof app)['~Routes']

	expectTypeOf<app['get']['response']>().toEqualTypeOf<{
		200: string
	}>()

	expectTypeOf<app['post']['response']>().toEqualTypeOf<{
		200: string
		201: string
		422: {
			type: 'validation'
			title: 'Validation Error'
			status: 422
			detail?: string
			on: string
			found?: unknown
			property?: string
			expected?: string
		}
	}>()

	expectTypeOf<app['true']['get']['response']>().toEqualTypeOf<{
		200: boolean
	}>()

	expectTypeOf<app['true']['post']['response']>().toEqualTypeOf<{
		200: boolean
		202: boolean
		422: {
			type: 'validation'
			title: 'Validation Error'
			status: 422
			detail?: string
			on: string
			found?: unknown
			property?: string
			expected?: string
		}
	}>()

	expectTypeOf<app['error']['get']['response']>().toEqualTypeOf<{
		418: 'a'
	}>()

	expectTypeOf<app['mirror']['post']['response']>().toEqualTypeOf<{}>()

	expectTypeOf<app['immutable']['get']['response']>().toEqualTypeOf<{
		200: '1'
	}>()

	expectTypeOf<app['immutable-error']['get']['response']>().toEqualTypeOf<{
		418: 'a'
	}>()

	expectTypeOf<app['async']['get']['response']>().toEqualTypeOf<{
		200: 'Hifumi'
		418: 'Nagisa'
	}>()

	expectTypeOf<app['default-error-code']['get']['response']>().toEqualTypeOf<{
		200: 'Hifumi'
		401: 'Unauthorized'
		418: 'Nagisa'
	}>()
}

app.get('/', ({ set }) => {
	// ? Able to set literal type to set.status
	set.status = "I'm a teapot"

	// ? Able to number to set.status
	set.status = 418
})

// ? Ephemeral and Current type
{
	const child = new Elysia()
		.derive('plugin', () => {
			return {
				hello: 'world'
			}
		})
		.get('/', ({ hello }) => {
			expectTypeOf<typeof hello>().toEqualTypeOf<'world'>()

			return 'hello'
		})

	const current = new Elysia().use(child).get('/', ({ hello }) => {
		expectTypeOf<typeof hello>().toEqualTypeOf<'world'>()

		return 'hello'
	})

	const parrent = new Elysia().use(current).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('hello')

		return 'hello'
	})
}

// ? Return file with File Schema
{
	const child = new Elysia().get(
		'/',
		{
			response: t.File()
		},
		() => {
			return file('test/kyuukurarin.mp4')
		}
	)
}

// ? Return file with Object File Schema
{
	const child = new Elysia().get(
		'/',
		{
			response: t.Form({
				a: t.File()
			})
		},
		() => {
			return form({
				a: file('test/kyuukurarin.mp4')
			})
		}
	)
}

// ? Accept file with Object File Schema
{
	const child = new Elysia().get(
		'/',
		{
			body: t.Object({
				file: t.File()
			}),
			response: t.File()
		},
		({ body: { file } }) => {
			expectTypeOf<typeof file>().toEqualTypeOf<File>()

			return file
		}
	)
}

type a = keyof {}

// It handle optional params
{
	new Elysia()
		.get('/:id?', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				id?: string
			}>()
		})
		.get('/:id/:name?', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				id: string
				name?: string
			}>()
		})
}

// ? Elysia.as
{
	// ? handle as global'
	{
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')
	}

	// handle as global with local override
	{
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: t.Boolean()
			})
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')
	}

	// handle as global with scoped override'
	{
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard('plugin', {
				response: t.String()
			})
			.get('/plugin', () => 'ok')

		const app = new Elysia().use(plugin).get('/', () => 'not a number')
	}

	// ? handle as global'
	{
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')
	}

	// ? handle as global with local override
	{
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: t.Boolean()
			})
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')
	}

	// handle as global with scoped override
	{
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard('plugin', {
				response: t.String()
			})
			.get('/plugin', () => 'ok')

		const app = new Elysia().use(plugin).get('/', () => 'not a number')
	}

	// ? handle as plugin
	{
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('plugin')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)

		const app = new Elysia().use(plugin).get('/', () => 'not a number')
	}

	// ? handle as propagate twice
	{
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('plugin')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)
			.as('plugin')

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')
	}

	// ? Reconcile status
	{
		const inner = new Elysia()
			.guard({
				response: {
					401: t.Number(),
					402: t.Number()
				}
			})
			.get('/inner', () => '')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: {
					401: t.Boolean()
				}
			})
			.get('/plugin', ({ status }) => {
				status('Payment Required', 20)
				return status(401, true)
			})

		const app = new Elysia().use(plugin).get('/', () => 'ok')
	}

	// ? Reconcile inline handle
	{
		const inner = new Elysia()
			.guard({
				response: {
					401: t.Number(),
					402: t.Number()
				}
			})
			.get('/inner', status(401, 1))
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: {
					401: t.Boolean()
				}
			})
			.get('/plugin', status(401, true))

		const app = new Elysia().use(plugin).get('/', status(401, 1))
	}
}

// ? Guard as
// handle as global
{
	const inner = new Elysia()
		.guard('global', {
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia()
		.use(inner)
		// @ts-expect-error
		.get('/plugin', () => true)

	// @ts-expect-error
	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// ? handle as global with local override
{
	const inner = new Elysia()
		.guard('global', {
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia()
		.use(inner)
		.guard({
			response: t.Boolean()
		})
		.get('/plugin', () => true)

	// @ts-expect-error
	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// handle as global with scoped override
{
	const inner = new Elysia()
		.guard('global', {
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia()
		.use(inner)
		.guard('plugin', {
			response: t.String()
		})
		.get('/plugin', () => 'ok')

	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// handle as global
{
	const inner = new Elysia()
		.guard('global', {
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia()
		.use(inner)
		// @ts-expect-error
		.get('/plugin', () => true)

	// @ts-expect-error
	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// handle as global with local override
{
	const inner = new Elysia()
		.guard('global', {
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia()
		.use(inner)
		.guard({
			response: t.Boolean()
		})
		.get('/plugin', () => true)

	// @ts-expect-error
	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// ? handle as global with scoped override
{
	const inner = new Elysia()
		.guard('global', {
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia()
		.use(inner)
		.guard('plugin', {
			response: t.String()
		})
		.get('/plugin', () => 'ok')

	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// handle as scoped
{
	const inner = new Elysia()
		.guard('plugin', {
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia()
		.use(inner)
		// @ts-expect-error
		.get('/plugin', () => true)

	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// handle as local
{
	const inner = new Elysia()
		.guard('local', {
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia().use(inner).get('/plugin', () => true)

	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// ? Nested guard
{
	new Elysia()
		.state('name', 'salt')
		.get(
			'/',
			{
				query: t.Object({
					name: t.String()
				})
			},
			({ store: { name } }) => `Hi ${name}`
		)
		// If query 'name' is not preset, skip the whole handler
		.guard(
			{
				query: t.Object({
					name: t.String()
				})
			},
			(app) =>
				app
					// Query type is inherited from guard
					.get('/profile', ({ query }) => `Hi`)
					// Store is inherited
					.post(
						'/name',
						{
							body: t.Object({
								id: t.Number({
									minimum: 5
								}),
								username: t.String(),
								profile: t.Object({
									name: t.String()
								})
							})
						},
						({ store, body, query }) => {
							expectTypeOf<typeof store>().toEqualTypeOf<{
								name: string
							}>()

							expectTypeOf<typeof query>().toEqualTypeOf<{
								name: string
							}>()

							expectTypeOf<typeof body>().toEqualTypeOf<{
								id: number
								username: string
								profile: {
									name: string
								}
							}>()
						}
					)
		)

	// ? Reconcile status
	{
		const inner = new Elysia()
			.guard('global', {
				response: {
					401: t.Number(),
					402: t.Number()
				}
			})
			.get('/inner', () => '')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: {
					401: t.Boolean()
				}
			})
			.get('/plugin', ({ status }) => {
				status('Payment Required', 20)
				return status(401, true)
			})

		const app = new Elysia().use(plugin).get('/', () => 'ok')
	}

	// ? Reconcile inline handle
	{
		const inner = new Elysia()
			.guard('global', {
				response: {
					401: t.Number(),
					402: t.Number()
				}
			})
			.get('/inner', status(401, 1))

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: {
					401: t.Boolean()
				}
			})
			.get('/plugin', status(401, true))

		const app = new Elysia().use(plugin).get('/', status(401, 1))
	}
}

// Derive guard
{
	new Elysia()
		.guard({
			query: t.Object({
				id: t.Number()
			})
		})
		.derive(({ query }) => {
			expectTypeOf<typeof query>().toEqualTypeOf<{
				id: number
			}>()
		})
		.derive(({ query }) => {
			expectTypeOf<typeof query>().toEqualTypeOf<{
				id: number
			}>()
		})
}

// ? As cast shouldn't resolve derive as any key
{
	const plugin = new Elysia()
		.derive(() => ({
			pluginMethod() {
				console.log('pluginMethod')
			}
		}))
		.derive(({ pluginMethod, ...rest }) => ({
			myPluginMethod: pluginMethod,
			...rest
		}))
		.as('plugin')

	expectTypeOf<(typeof plugin)['~Ephemeral']['derive']>().toHaveProperty(
		'pluginMethod'
	)
}

// ? afterResponse type
{
	const app = new Elysia().get(
		'/',
		{
			response: {
				200: t.Object({
					duration: t.Number()
				}),
				400: t.Object({
					stuff: t.Number()
				})
			},
			afterResponse({ responseValue }) {
				// expectTypeOf<typeof response>().toEqualTypeOf<
				// 	| {
				// 			duration: number
				// 	  }
				// 	| {
				// 			stuff: number
				// 	  }
				// >()
				// return undefined as any
			}
		},
		() => {
			return {
				duration: 200
			}
		}
	)
}

// ? params in local lifecycle should follow path prefix
{
	new Elysia()
		.parse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.derive(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()

			return {}
		})
		.derive(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()

			return {}
		})
		.transform(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.beforeHandle(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.afterHandle(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.mapResponse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.afterResponse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
}

// ? params in local lifecycle should follow path prefix
{
	new Elysia({ prefix: '/:id' })
		.parse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.derive(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()

			return {}
		})
		.derive(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()

			return {}
		})
		.transform(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.beforeHandle(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.afterHandle(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.mapResponse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.afterResponse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
}

// ? params in local lifecycle should respect global scope
{
	new Elysia({ prefix: '/:id' })
		.parse('global', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.derive('global', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()

			return {}
		})
		.derive('global', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()

			return {}
		})
		.transform('global', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.beforeHandle('global', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.afterHandle('global', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.mapResponse('global', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.afterResponse('global', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
}

// ? params in local lifecycle should respect scoped scope
{
	new Elysia({ prefix: '/:id' })
		.parse('plugin', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.derive('plugin', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()

			return {}
		})
		.derive('plugin', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()

			return {}
		})
		.transform('plugin', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.beforeHandle('plugin', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.afterHandle('plugin', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.mapResponse('plugin', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
		.afterResponse('plugin', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
}

// ? onAfterResponse should have derivative
{
	new Elysia()
		.derive(() => {
			return {
				startTime: performance.now()
			}
		})
		.afterResponse((ctx) => {
			expectTypeOf<typeof ctx>().not.toBeNever()
			expectTypeOf<(typeof ctx)['startTime']>().toBeNumber()
		})
}

// ? Websocket Response
{
	new Elysia().ws('/', {
		open: (ws) => {
			ws.publish('channel', 'hello')
		},
		response: t.String()
	})
}

// ? Macro resolve
{
	const app = new Elysia()
		.macro({
			user: (enabled: boolean) => ({
				derive: async ({ query: { name = 'anon' } }) => ({
					user: {
						name,
						async: false
					} as const
				})
			}),
			asyncUser: (enabled: boolean) => ({
				derive: async ({ query: { name = 'anon' } }) => ({
					user: {
						name,
						async: true
					} as const
				})
			})
		})
		.get(
			'/',
			{
				user: true
			},
			({ user }) => {
				expectTypeOf<typeof user>().toEqualTypeOf<{
					readonly name: string
					readonly async: false
				}>()
			}
		)
		.get(
			'/',
			{
				asyncUser: true
			},
			({ user }) => {
				expectTypeOf<typeof user>().toEqualTypeOf<{
					readonly name: string
					readonly async: true
				}>()
			}
		)
}

// Macro
{
	const userService = new Elysia({ name: 'user/service' })
		.state({
			user: {} as Record<string, string>,
			session: {} as Record<number, string>
		})
		.model({
			signIn: t.Object({
				username: t.String({ minLength: 1 }),
				password: t.String({ minLength: 8 })
			}),
			session: t.Cookie(
				{
					token: t.Number()
				},
				{
					secrets: 'seia'
				}
			),
			optionalSession: t.Optional(t.Ref('session'))
		})
		.macro({
			isSignIn(enabled: boolean) {
				if (!enabled) return {}

				return {
					beforeHandle({
						status,
						cookie: { token },
						store: { session }
					}) {
						if (!token.value)
							return status(401, {
								success: false,
								message: 'Unauthorized'
							})

						expectTypeOf<typeof session>().toEqualTypeOf<
							Record<number, string>
						>()

						const username =
							session[token.value as unknown as number]

						if (!username)
							return status(401, {
								success: false,
								message: 'Unauthorized'
							})
					}
				}
			}
		})
}

// Use validation response instead of return type
{
	const app = new Elysia().get(
		'/',
		{
			response: {
				200: t.Object({
					name: t.String()
				}),
				400: t.Object({
					name: t.String()
				})
			}
		},
		() => {
			return {
				name: 'a',
				a: 'b'
			}
		}
	)

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<{
		name: string
	}>()
}

// Use return type when validation is not provided
{
	const app = new Elysia().get(
		'/',
		{
			response: {
				400: t.Object({
					name: t.String()
				})
			}
		},
		() => {
			return {
				name: 'a',
				a: 'b'
			}
		}
	)

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<{
		name: string
		a: string
	}>()
}

// ? cookie sample
{
	const app = new Elysia()
		.get(
			'/council',
			{
				cookie: t.Cookie({
					council: t.Optional(
						t.Array(
							t.Object({
								name: t.String(),
								affilation: t.String()
							})
						)
					)
				})
			},
			({ cookie: { council } }) =>
				(council.value = [
					{
						name: 'Rin',
						affilation: 'Administration'
					}
				])
		)
		.get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
		.get('/multiple', ({ cookie: { name, president } }) => {
			name.value = 'Himari'
			president.value = 'Rio'

			return 'ok'
		})
		.get(
			'/update',
			{
				cookie: t.Cookie(
					{
						name: t.Optional(t.String())
					},
					{
						secrets: 'a',
						sign: ['name']
					}
				)
			},
			({ cookie: { name } }) => {
				name.value = 'seminar: Himari'

				return name.value
			}
		)
		.get('/remove', ({ cookie }) => {
			for (const self of Object.values(cookie)) self.remove()

			return 'Deleted'
		})
		.get('/remove-with-options', ({ cookie }) => {
			for (const self of Object.values(cookie)) self.remove()

			return 'Deleted'
		})
		.get('/set', ({ cookie: { session } }) => {
			session.value = 'rin'
			session.set({
				path: '/'
			})
		})
}

// Handle macro with function
{
	const app = new Elysia()
		.macro({
			a: {
				derive: () => ({
					a: 'a'
				})
			}
		})
		.get(
			'/a',
			{
				a: true
				// beforeHandle: (c) => {}
			},
			({ a }) => {
				expectTypeOf<typeof a>().toEqualTypeOf<string>()
			}
		)
		.ws('/', {
			a: true,
			message({ a }) {
				expectTypeOf<typeof a>().toEqualTypeOf<string>()
			}
		})
}

// Type AfterHandler according to known schema
{
	new Elysia().get(
		'/',
		{
			afterResponse({ responseValue }) {
				expectTypeOf<typeof responseValue>().toEqualTypeOf<
					string | number
				>()
			},
			response: {
				200: t.String(),
				400: t.Number()
			}
		},
		() => 'yay'
	)
}

// Handle Prefix
{
	const app = new Elysia().group('/users', (app) =>
		app
			.post('/', async ({ body }) => {
				// Create user endpoint
				return { success: true, userId: 1 }
			})
			.get('/:id', async ({ params }) => {
				// Get user by ID endpoint
				return { id: params.id, name: 'John Doe' }
			})
	)

	expectTypeOf<keyof (typeof app)['~Routes']['users']>().toEqualTypeOf<
		'post' | ':id'
	>()
}

// onError should have status
{
	new Elysia().error(({ status }) => {
		status(200)
	})
}

// onAfterHandle should have response
{
	new Elysia().afterHandle('plugin', ({ responseValue }) => responseValue)
}

/* Neither `a` or `b` exist at the type level, even though they do exist at runtime */
{
	new Elysia()
		.macro({
			a: {
				body: t.Object({
					a: t.String()
				}),
				derive: () => ({ a: 'a' as const })
			},
			b: {
				body: t.Object({
					b: t.String()
				}),
				derive: () => ({ b: 'b' as const })
			}
		})
		.get(
			'/test',
			{
				a: true,
				b: true
			},
			({ a, b, body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{
					a: string
					b: string
				}>()

				expectTypeOf<typeof a>().toEqualTypeOf<'a'>()
				expectTypeOf<typeof b>().toEqualTypeOf<'b'>()

				return { a, b }
			}
		)
}

// append prefix / if not provided
{
	const plugin = new Elysia({ prefix: 'v1' }).get('thing', 'thing')

	const app = new Elysia({ prefix: 'api' }).use(plugin)

	// This should not error
	app['~Routes']?.api.v1.thing
}

// handle status in afterResponse
{
	new Elysia().get(
		'/',
		{
			afterHandle: ({ status }) => status(201, { foo: 'bar' }),
			response: {
				201: t.Object({
					foo: t.String()
				})
			}
		},
		() => ''
	)

	const route = new Elysia().get(
		'/',
		{
			// @ts-expect-error afterHandle return must satisfy the response schema
			afterHandle: () => ({ q: 'a' }),
			response: t.Object({
				foo: t.String()
			})
		},
		() => ({ foo: 'a' })
	)
}

// infer SSE type correctly
{
	const app = new Elysia().get('/', function* () {
		yield sse('a')

		yield sse({
			event: 'a',
			data: 'b'
		})
	})

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<
		Generator<
			| {
					readonly data: 'a'
			  }
			| {
					readonly event: 'a'
					readonly data: 'b'
			  },
			void,
			unknown
		>
	>()
}

// return generator SSE type correctly
{
	function* a() {
		yield 'a'
		yield 'b'
	}

	const app = new Elysia().get('/', () => sse(a()))

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<
		Generator<
			| {
					readonly data: 'a'
			  }
			| {
					readonly data: 'b'
			  },
			void,
			unknown
		>
	>()
}

// return async generator SSE type correctly
{
	async function* a() {
		yield 'a'
		yield 'b'
	}

	const app = new Elysia().get('/', () => sse(a()))

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<
		AsyncGenerator<
			| {
					readonly data: 'a'
			  }
			| {
					readonly data: 'b'
			  },
			void,
			unknown
		>
	>()
}

// return ReadableStream SSE type correctly
{
	async function* a() {
		yield 'a'
		yield 'b'
	}

	const app = new Elysia().get('/', () =>
		sse(undefined as any as ReadableStream<'a'>)
	)

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<
		ReadableStream<{
			readonly data: 'a'
		}>
	>()
}

// infer ReadableStream to Iterable
{
	const app = new Elysia()
		.get('/', () => undefined as any as ReadableStream<'a'>)
		.listen(3000)

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<ReadableStream<'a'>>()
}

// Inline Elysia file
{
	new Elysia().get('/file', file('public/takodachi.png'))
}

// derive should add property union correctly
{
	const app = new Elysia()
		.derive(({ request, status }) => {
			const apiKey = request.headers.get('x-api-key')
			if (!apiKey) return { auth: null }

			if (Math.random() > 0.5) return status(401)

			return { auth: { id: 1 } }
		})
		.beforeHandle(({ auth }) => {
			expectTypeOf<typeof auth>().toEqualTypeOf<{
				readonly id: 1
			} | null>()
		})
}

// resolve should add property union correctly
{
	const app = new Elysia()
		.derive(({ request, status }) => {
			const apiKey = request.headers.get('x-api-key')
			if (!apiKey) return { auth: null }

			if (Math.random() > 0.5) return status(401)

			return { auth: { id: 1 } }
		})
		.beforeHandle(({ auth }) => {
			expectTypeOf<typeof auth>().toEqualTypeOf<{
				readonly id: 1
			} | null>()
		})
}

// transform shouldn't inherit schema type
{
	new Elysia()
		.guard({
			body: t.Object({
				a: t.String()
			}),
			params: t.Object({
				id: t.String()
			})
		})
		.transform(({ params, body }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()

			expectTypeOf<typeof body>().toBeUnknown()
		})
}

// transform should cast params to unknown when scope is over local
{
	new Elysia({ prefix: '/:id' })
		.transform(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				id: string
			}>()
		})
		.transform('plugin', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				[name: string]: string | undefined
			}>()
		})
}

// Enforce return type in OptionalHandler
{
	new Elysia().get(
		'/',
		{
			beforeHandle: ({ status }) => {
				if (Math.random() > 0.5) {
					// @ts-expect-error
					return status(401, { a: 'Unauthorized' })
				}

				return status(401, { error: 'Unauthorized' })
			},
			response: {
				401: t.Object({
					error: t.String()
				})
			}
		},
		({ status }) => {
			return status(401, { error: 'Unauthorized' })
		}
	)
}

// Enforce return type of Generator
{
	const message = t.Object({
		event: t.String(),
		data: t.Object({
			message: t.String(),
			timestamp: t.String()
		})
	})

	new Elysia().get(
		'/sse',
		{
			response: {
				200: message
			}
		},
		function* () {
			yield sse({
				event: 'message',
				data: {
					message: 'This is a message',
					timestamp: new Date().toISOString()
				}
			})
		}
	)
}

// Enforce return type of AsyncGenerator
{
	const message = t.Object({
		event: t.String(),
		data: t.Object({
			message: t.String(),
			timestamp: t.String()
		})
	})

	new Elysia().get(
		'/sse',
		{
			response: {
				200: message
			}
		},
		async function* () {
			yield sse({
				event: 'message',
				data: {
					message: 'This is a message',
					timestamp: new Date().toISOString()
				}
			})
		}
	)
}

// Strict status response
{
	new Elysia().post(
		'/mirror',
		{
			body: t.Object({
				code: t.String()
			}),
			response: {
				200: t.Object({
					success: t.Literal(true)
				}),
				201: t.Object({
					success: t.Literal(false)
				})
			}
		},
		async ({ status, body }) => {
			if (Math.random() > 0.5)
				// @ts-expect-error - should reject extra 'body' property
				return status(201, { body, success: false })

			// @ts-expect-error
			if (Math.random() > 0.5) return status(200, { success: false })

			// @ts-expect-error
			if (Math.random() > 0.5) return status(201, { success: true })
			if (Math.random() > 0.5) return status(200, { success: true })

			return status(201, { success: false })
		}
	)
}

// Status code 200 type inference (issue #1584)
{
	const app = new Elysia().get(
		'/',
		{
			response: {
				200: t.Object({
					message: t.Literal('Hello Elysia')
				})
			}
		},
		() => ({ message: 'Hello Elysia' as const })
	)

	type AppResponse = (typeof app)['~Routes']['get']['response']

	// Should properly infer the 200 response type, not [x: string]: any
	const _typeTest: AppResponse extends {
		200: { message: 'Hello Elysia' }
	}
		? true
		: false = true

	// Test with multiple status codes including 200
	const app2 = new Elysia().post(
		'/test',
		{
			response: {
				200: t.Object({
					message: t.Literal('Hello Elysia')
				}),
				422: t.Object({
					error: t.String()
				})
			}
		},
		({ status }) => {
			if (Math.random() > 0.5) {
				return status(200, { message: 'Hello Elysia' as const })
			}
			return status(422, { error: 'Validation error' })
		}
	)

	type App2Response = (typeof app2)['~Routes']['test']['post']['response']

	const _typeTest2: App2Response extends {
		200: { message: 'Hello Elysia' }
		422: { error: string }
	}
		? true
		: false = true
}

// group empty prefix
{
	const app = new Elysia()
		.group('', (app) => {
			return app.get('/ok', () => 'Hello World')
		})
		.listen(3000)

	type Routes = keyof (typeof app)['~Routes']

	expectTypeOf<Routes>().toEqualTypeOf<'ok'>()
}

// override group prefix type
{
	new Elysia().group('/:example', (app) =>
		app.get(
			'/',
			{
				params: t.Object({
					example: t.Numeric()
				})
			},
			({ params: { example } }) => {
				expectTypeOf<typeof example>().toBeNumber()
			}
		)
	)
}

// ? params with model
{
	new Elysia()
		.model({
			'character.name': t.String(),
			'character.thing': t.Object({
				name: t.String()
			})
		})
		.get('/id/:id/name/:name', ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				id: string
				name: string
			}>()
		})
}

// ? Promise<Response>
{
	async function handler() {
		return new Response(JSON.stringify({ text: 'hello' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		})
	}

	new Elysia().get(
		'/hello',
		{
			response: { 200: t.Object({ text: t.String() }) }
		},
		() => handler()
	)
}

// ───────────────────────────────────────────────────────────────────────────
// WebSocket footgun coverage (ctx + route-tree). Locks in the behavior fixed in
// the ws-nesting type port; see CHANGELOG. Bug-exposing gaps are tracked
// separately, not asserted here.
// ───────────────────────────────────────────────────────────────────────────

// ws send/publish payloads must match the `response` schema — guards against
// silently reverting to `string | BufferSource`.
{
	new Elysia().ws('/ws-send-string', {
		response: t.String(),
		open(ws) {
			// @ts-expect-error number is not assignable to string response
			ws.send(123)
			// @ts-expect-error number is not assignable to string response
			ws.publish('topic', 123)
		}
	})
	new Elysia().ws('/ws-send-object', {
		response: t.Object({ ok: t.Boolean() }),
		open(ws) {
			// @ts-expect-error wrong shape vs response object
			ws.send({ wrong: 1 })
		}
	})
}

// ws.query / ws.headers reflect their schemas top-level on the ctx, alongside
// ws.params (existing tests only cover params).
{
	new Elysia().ws('/ws-ctx-data/:id', {
		params: t.Object({ id: t.Number() }),
		query: t.Object({ q: t.String() }),
		headers: t.Object({ authorization: t.String() }),
		open(ws) {
			expectTypeOf<typeof ws.params>().toEqualTypeOf<{ id: number }>()
			expectTypeOf<typeof ws.query>().toEqualTypeOf<{ q: string }>()
			expectTypeOf<typeof ws.headers>().toEqualTypeOf<{
				authorization: string
			}>()
		}
	})
}

// Non-message ws handlers carry no inbound payload, so ws.body is `never` even
// with a declared body schema.
{
	new Elysia().ws('/ws-body-open', {
		body: t.Object({ name: t.String() }),
		open(ws) {
			expectTypeOf<typeof ws.body>().toBeNever()
		}
	})
}

// `message` is the one ws handler with an inbound payload: ws.body and the
// destructured `{ body }` are typed from the `body` schema (the core ws use).
{
	new Elysia().ws('/ws-msg-body', {
		body: t.Object({ name: t.String() }),
		message(ws) {
			expectTypeOf<typeof ws.body>().toEqualTypeOf<{ name: string }>()
		}
	})
	new Elysia().ws('/ws-msg-body-destructured', {
		body: t.Object({ name: t.String() }),
		message({ body }) {
			expectTypeOf<typeof body>().toEqualTypeOf<{ name: string }>()
		}
	})
}

// ws `message` may return `status(code, value)` for a status-keyed `response`,
// validated against the matching schema (mirrors HTTP handlers).
{
	new Elysia().ws('/ws-status', {
		response: {
			200: t.Object({ ok: t.Boolean() }),
			400: t.Object({ reason: t.String() })
		},
		message(ws) {
			if (Math.random()) return ws.status(400, { reason: 'bad' })
			return { ok: true }
		}
	})
	new Elysia().ws('/ws-status-bad', {
		response: {
			200: t.Object({ ok: t.Boolean() }),
			400: t.Object({ reason: t.String() })
		},
		message(ws) {
			// @ts-expect-error wrong shape for status 400
			return ws.status(400, { wrong: 1 })
		}
	})
}

// A value-macro applied on a ws route type-checks its argument exactly like on
// HTTP routes: correct literal accepted, wrong type errors.
{
	const app = new Elysia().macro({
		a(_a: string) {}
	})
	app.ws('/ws-macro-ok', {
		a: 'hello',
		message() {}
	})
	app.ws('/ws-macro-bad', {
		// @ts-expect-error macro `a` expects a string
		a: 1,
		message() {}
	})
}

// ws `response` schema surfaces in subscribe.response with the auto-422 channel,
// so Eden clients read the typed outbound message + validation channel.
{
	const app = new Elysia().ws('/ws-resp', {
		response: t.String(),
		message() {}
	})
	type Sub = (typeof app)['~Routes']['ws-resp']['subscribe']
	expectTypeOf<Sub['response'][200]>().toEqualTypeOf<string>()
	expectTypeOf<
		422 extends keyof Sub['response'] ? true : false
	>().toEqualTypeOf<true>()
}

// subscribe has NO `error` key (CreateWSEdenResponse omits it); http get DOES
// (`error: never`). This is the single distinguishing field of the two shapes.
{
	const ws = new Elysia().ws('/ws-err', { message() {} })
	type WsSub = (typeof ws)['~Routes']['ws-err']['subscribe']
	expectTypeOf<
		'error' extends keyof WsSub ? true : false
	>().toEqualTypeOf<false>()
	const http = new Elysia().get('/http-err', () => 'hi')
	type HttpGet = (typeof http)['~Routes']['http-err']['get']
	expectTypeOf<
		'error' extends keyof HttpGet ? true : false
	>().toEqualTypeOf<true>()
}

// group query (outer) + guard headers (inner) both merge into one subscribe —
// the realistic 'auth gateway wrapping a socket' shape.
{
	const app = new Elysia().group(
		'/v1ws',
		{ query: t.Object({ name: t.String() }) },
		(app) =>
			app.guard(
				{ headers: t.Object({ authorization: t.String() }) },
				(app) => app.ws('/sock', { message() {} })
			)
	)
	type Sub = (typeof app)['~Routes']['v1ws']['sock']['subscribe']
	expectTypeOf<Sub['query']>().toEqualTypeOf<{ name: string }>()
	expectTypeOf<Sub['headers']>().toEqualTypeOf<{ authorization: string }>()
}

// get + ws at the SAME path coexist as distinct keys; neither clobbers the
// other and the ws body schema survives on subscribe.
{
	const app = new Elysia()
		.get('/dual', () => 'hi')
		.ws('/dual', { body: t.Object({ text: t.String() }), message() {} })
	type Route = (typeof app)['~Routes']['dual']
	expectTypeOf<
		'get' extends keyof Route ? true : false
	>().toEqualTypeOf<true>()
	expectTypeOf<
		'subscribe' extends keyof Route ? true : false
	>().toEqualTypeOf<true>()
	expectTypeOf<Route['subscribe']['body']>().toEqualTypeOf<{ text: string }>()
}

// 3-arg ws form: a generator handler's `yield` type flows into
// subscribe.response (typed streamed messages for Eden), with no explicit
// `response` schema.
{
	const app = new Elysia().ws('/ws-gen', function* () {
		yield { tick: 1 }
	})
	type Sub = (typeof app)['~Routes']['ws-gen']['subscribe']
	expectTypeOf<Sub['response'][200]>().toEqualTypeOf<{ tick: number }>()
}

// async generator handler
{
	const app = new Elysia().ws('/ws-agen', async function* () {
		yield 'hello'
	})
	type Sub = (typeof app)['~Routes']['ws-agen']['subscribe']
	expectTypeOf<Sub['response'][200]>().toEqualTypeOf<string>()
}

// 3-arg form with a body schema in options: the handler ctx is typed
// (ws.body) AND the yield flows into subscribe.response.
{
	const app = new Elysia().ws(
		'/ws-echo',
		{ body: t.Object({ text: t.String() }) },
		function* (ws) {
			expectTypeOf<typeof ws.body>().toEqualTypeOf<{ text: string }>()
			yield ws.body
		}
	)
	type Sub = (typeof app)['~Routes']['ws-echo']['subscribe']
	expectTypeOf<Sub['response'][200]>().toEqualTypeOf<{ text: string }>()
	expectTypeOf<Sub['body']>().toEqualTypeOf<{ text: string }>()
}

// 3-arg ws form with a PLAIN (non-generator) handler: its return type flows
// into subscribe.response (a void-returning handler contributes nothing).
{
	const app = new Elysia().ws('/ws-ret', () => ({ ok: true }))
	type Sub = (typeof app)['~Routes']['ws-ret']['subscribe']
	expectTypeOf<Sub['response'][200]>().toEqualTypeOf<{ ok: boolean }>()
}

// 3-arg form WITH options + a plain (non-generator) handler: the handler
// return flows into subscribe.response just like the 2-arg-function form,
// and the ctx (ws.body) is typed from the options schema.
{
	const app = new Elysia().ws(
		'/ws-3arg-ret',
		{ body: t.Object({ id: t.Number() }) },
		(ws) => {
			expectTypeOf<typeof ws.body>().toEqualTypeOf<{ id: number }>()
			return { done: true }
		}
	)
	type Sub = (typeof app)['~Routes']['ws-3arg-ret']['subscribe']
	expectTypeOf<Sub['response'][200]>().toEqualTypeOf<{ done: boolean }>()
	expectTypeOf<Sub['body']>().toEqualTypeOf<{ id: number }>()
}
