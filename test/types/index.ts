/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	t,
	Elysia,
	RouteSchema,
	Cookie,
	error,
	file,
	sse,
	SSEPayload
} from '../../src'
import { expectTypeOf } from 'expect-type'

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
			Record<string, Cookie<string | undefined>> & {
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

app.model({
	t: t.Object({
		username: t.String(),
		password: t.String()
	})
}).get(
	'/',
	({ body }) => {
		// ? unwrap body type
		expectTypeOf<
			{
				username: string
				password: string
			}[]
		>().toEqualTypeOf<typeof body>()

		return body
	},
	{
		body: 't[]',
		response: 't[]'
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
			.get(
				'/',
				({ body }) => {
					expectTypeOf<typeof body>().not.toBeUnknown()
					expectTypeOf<typeof body>().toEqualTypeOf<string[]>()
				},
				{
					body: 'string[]'
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

	expectTypeOf<(typeof app)['decorator']['a']>().toEqualTypeOf<
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
		.decorate(
			{ as: 'override' },
			{
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			}
		)

	expectTypeOf<typeof app.decorator.hello>().toEqualTypeOf<{
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

	expectTypeOf<(typeof app)['store']['a']>().toEqualTypeOf<
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
		.state(
			{ as: 'override' },
			{
				hello: {
					world: 'Ina',
					cookie: 'wah!'
				}
			}
		)

	expectTypeOf<typeof app.store.hello>().toEqualTypeOf<{
		world: string
		cookie: string
	}>()
}

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
	.post(
		'/',
		({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<'c'[]>()
		},
		{
			body: 'c[]'
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
	app.resolve(async ({ headers }) => {
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
	.onRequest((context) => {
		expectTypeOf<
			'b' extends keyof typeof context ? true : false
		>().toEqualTypeOf<false>()
	})
	// ? Resolve should not include in onTransform
	.onTransform((context) => {
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
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toBeString()
		},
		{
			body: 'string'
		}
	)
	.get(
		'/',
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toEqualTypeOf<string[]>()
		},
		{
			body: 'string[]'
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
	(app) => {
		app['~Metadata'].schema

		return app.get(
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
						app.get('/a', () => 1, {
							body: t.String()
						})
				)
		)
		.get('/', () => 1)

	type App = (typeof server)['~Routes']
	type Route = App['v1']['a']['get']

	expectTypeOf<Route>().toEqualTypeOf<{
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
				on: string
				summary?: string
				message?: string
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
		body: unknown
		params: Record<never, string>
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

							ws.data.params
						},
						body: t.String()
					})
			)
	)
	type App = (typeof server)['~Routes']
	type Route = App['v1']['a']['subscribe']
	expectTypeOf<Route>().toEqualTypeOf<{
		body: string
		params: Record<never, string>
		query: {
			name: string
		}
		headers: {
			authorization: string
		}
		response: unknown
	}>()
}

// ? Register empty model
{
	const server = app.get('/', () => 'Hello').get('/a', () => 'hi')

	type App = (typeof server)['~Routes']
	type Route = App['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		body: unknown
		headers: unknown
		query: unknown
		params: {}
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

	type App = (typeof server)['~Routes']
	type Route = App['get']

	expectTypeOf<Route>().toEqualTypeOf<{
		body: unknown
		headers: unknown
		query: unknown
		params: Record<never, string>
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
						headers: unknown
						query: unknown
						params: Record<never, string>
						response: {
							200: string
						}
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
	}).derive({ as: 'global' }, () => {
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
	expectTypeOf<keyof (typeof main)['definitions']>().not.toEqualTypeOf<{
		type: {
			b: string
		}
		error: {}
	}>()
}

// ? WebSocket infers params
{
	new Elysia()
		.ws('/:id', {
			open(ws) {
				expectTypeOf<typeof ws.data.params>().toEqualTypeOf<{
					id: string
				}>()
			}
		})
		.ws('/:id', {
			params: t.Object({
				id: t.Number()
			}),
			open(ws) {
				expectTypeOf<typeof ws.data.params>().toEqualTypeOf<{
					id: number
				}>()
			}
		})
}

const a = app
	.resolve(({ headers }) => {
		return {
			authorization: headers.authorization as string
		}
	})
	// .get('/', ({ authorization }) => {
	// 	// ? infers derive type
	// 	expectTypeOf<typeof authorization>().toBeString()
	// })
	.decorate('a', 'b')
	.resolve(({ a }) => {
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
	// ? Resolve should not include in onTransform
	.onTransform((context) => {
		expectTypeOf<
			'b' extends keyof typeof context ? true : false
		>().toEqualTypeOf<false>()
	})
	// ? Resolve should not include in onBeforeHandle
	.onBeforeHandle((context) => {
		expectTypeOf<
			'b' extends keyof typeof context ? true : false
		>().toEqualTypeOf<true>()
	})

{
	app.macro(() => {
		return {
			a(a: string) {}
		}
	})
		.get('/', () => {}, {
			// ? Should contains macro
			a: 'a'
		})
		.get('/', () => {}, {
			// ? Should have error
			// @ts-expect-error
			a: 1
		})
		.macro(() => {
			return {
				b(a: number) {}
			}
		})
		.get('/', () => {}, {
			// ? Should merge macro
			a: 'a',
			b: 2
		})
		.guard(
			{
				// ? Should contains macro
				a: 'a',
				b: 2
			},
			(app) =>
				app.get('/', () => {}, {
					// ? Should contains macro
					a: 'a',
					b: 2
				})
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

	expectTypeOf<(typeof app)['~Routes']>().toEqualTypeOf<{
		api: {
			test: {
				'could-be-error': {
					right: {
						get: {
							body: unknown
							params: {}
							query: unknown
							headers: unknown
							response: {
								200: {
									couldBeError: boolean
								}
							}
						}
					}
				}
			}
		} & {
			test: {
				deep: {
					ws: {
						subscribe: {
							body: unknown
							params: {}
							query: unknown
							headers: unknown
							response: unknown
						}
					}
				}
			}
		}
	}>()
}

// ? Handle error status
{
	const a = new Elysia()
		.get('/', ({ error }) => error(418, 'a'), {
			response: {
				200: t.String(),
				418: t.Literal('a')
			}
		})
		// @ts-expect-error
		.get('/', ({ error }) => error(418, 'b'), {
			response: {
				200: t.String(),
				418: t.Literal('a')
			}
		})
}

// ? Get response type correctly
{
	const app = new Elysia()
		.get('', () => 'a')
		.get('/true', () => true)
		.post('', () => 'a', { response: { 201: t.String() } })
		.post('/true', () => true, { response: { 202: t.Boolean() } })
		.get('/error', ({ error }) => error("I'm a teapot", 'a'))
		.post('/mirror', ({ body }) => body)
		.get('/immutable', '1')
		.get('/immutable-error', ({ error }) => error("I'm a teapot", 'a'))
		.get('/async', async ({ error }) => {
			if (Math.random() > 0.5) return error("I'm a teapot", 'Nagisa')

			return 'Hifumi'
		})
		.get('/default-error-code', ({ error }) => {
			if (Math.random() > 0.5) return error(418, 'Nagisa')
			if (Math.random() > 0.5) return error(401)

			return 'Hifumi'
		})

	type app = (typeof app)['~Routes']

	expectTypeOf<app['get']['response']>().toEqualTypeOf<{
		200: string
	}>()

	expectTypeOf<app['post']['response']>().toEqualTypeOf<{
		200: string
		readonly 201: string
		422: {
			type: 'validation'
			on: string
			summary?: string
			message?: string
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
		readonly 202: boolean
		422: {
			type: 'validation'
			on: string
			summary?: string
			message?: string
			found?: unknown
			property?: string
			expected?: string
		}
	}>()

	expectTypeOf<app['error']['get']['response']>().toEqualTypeOf<{
		200: never
		418: 'a'
	}>()

	expectTypeOf<app['mirror']['post']['response']>().toEqualTypeOf<{
		200: unknown
	}>()

	expectTypeOf<app['immutable']['get']['response']>().toEqualTypeOf<{
		200: '1'
	}>()

	expectTypeOf<app['immutable-error']['get']['response']>().toEqualTypeOf<{
		200: never
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
		.derive({ as: 'scoped' }, () => {
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
		() => {
			return file('test/kyuukurarin.mp4')
		},
		{
			response: t.File()
		}
	)
}

// ? Return file with Object File Schema
{
	const child = new Elysia().get(
		'/',
		() => {
			return {
				a: file('test/kyuukurarin.mp4')
			}
		},
		{
			response: t.Object({
				a: t.File()
			})
		}
	)
}

// ? Accept file with Object File Schema
{
	const child = new Elysia().get(
		'/',
		({ body: { file } }) => {
			expectTypeOf<typeof file>().toEqualTypeOf<File>()

			return file
		},
		{
			body: t.Object({
				file: t.File()
			}),
			response: t.File()
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
			.guard({
				as: 'scoped',
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
			.guard({
				as: 'scoped',
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
			.as('scoped')

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
			.as('scoped')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)
			.as('scoped')

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
			.get('/plugin', ({ error }) => {
				error('Payment Required', 20)
				return error(401, true)
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
			.get('/inner', '')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: {
					401: t.Boolean()
				}
			})
			.get('/plugin', error(401, true))

		const app = new Elysia().use(plugin).get('/', 'ok')
	}
}

// ? Guard as
// handle as global
{
	const inner = new Elysia()
		.guard({
			as: 'global',
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
		.guard({
			as: 'global',
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
		.guard({
			as: 'global',
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia()
		.use(inner)
		.guard({
			as: 'scoped',
			response: t.String()
		})
		.get('/plugin', () => 'ok')

	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// handle as global
{
	const inner = new Elysia()
		.guard({
			as: 'global',
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
		.guard({
			as: 'global',
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
		.guard({
			as: 'global',
			response: t.Number()
		})
		// @ts-expect-error
		.get('/inner', () => 'a')

	const plugin = new Elysia()
		.use(inner)
		.guard({
			as: 'scoped',
			response: t.String()
		})
		.get('/plugin', () => 'ok')

	const app = new Elysia().use(plugin).get('/', () => 'not a number')
}

// handle as scoped
{
	const inner = new Elysia()
		.guard({
			as: 'scoped',
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
		.guard({
			as: 'local',
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
		.get('/', ({ store: { name } }) => `Hi ${name}`, {
			query: t.Object({
				name: t.String()
			})
		})
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
						},
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
						}
					)
		)

	// ? Reconcile status
	{
		const inner = new Elysia()
			.guard({
				as: 'global',
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
			.get('/plugin', ({ error }) => {
				error('Payment Required', 20)
				return error(401, true)
			})

		const app = new Elysia().use(plugin).get('/', () => 'ok')
	}

	// ? Reconcile inline handle
	{
		const inner = new Elysia()
			.guard({
				as: 'global',
				response: {
					401: t.Number(),
					402: t.Number()
				}
			})
			.get('/inner', '')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: {
					401: t.Boolean()
				}
			})
			.get('/plugin', error(401, true))

		const app = new Elysia().use(plugin).get('/', 'ok')
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
		.resolve(({ query }) => {
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
		.as('scoped')

	expectTypeOf<(typeof plugin)['~Ephemeral']['derive']>().toHaveProperty(
		'pluginMethod'
	)
}

// ? afterResponse type
{
	const app = new Elysia().get(
		'/',
		() => {
			return {
				duration: 200
			}
		},
		{
			response: {
				200: t.Object({
					duration: t.Number()
				}),
				400: t.Object({
					stuff: t.Number()
				})
			},
			afterResponse({ response }) {
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
		}
	)
}

// ? params in local lifecycle should follow path prefix
{
	new Elysia()
		.onParse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{}>()
		})
		.derive(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{}>()

			return {}
		})
		.resolve(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{}>()

			return {}
		})
		.onTransform(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{}>()
		})
		.onBeforeHandle(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{}>()
		})
		.onAfterHandle(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{}>()
		})
		.mapResponse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{}>()
		})
		.onAfterResponse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{}>()
		})
}

// ? params in local lifecycle should follow path prefix
{
	new Elysia({ prefix: '/:id' })
		.onParse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.derive(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()

			return {}
		})
		.resolve(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()

			return {}
		})
		.onTransform(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.onBeforeHandle(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.onAfterHandle(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.mapResponse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
		.onAfterResponse(({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
		})
}

// ? params in local lifecycle should respect global scope
{
	new Elysia({ prefix: '/:id' })
		.onParse({ as: 'global' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.derive({ as: 'global' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()

			return {}
		})
		.resolve({ as: 'global' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()

			return {}
		})
		.onTransform({ as: 'global' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.onBeforeHandle({ as: 'global' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.onAfterHandle({ as: 'global' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.mapResponse({ as: 'global' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.onAfterResponse({ as: 'global' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
}

// ? params in local lifecycle should respect scoped scope
{
	new Elysia({ prefix: '/:id' })
		.onParse({ as: 'scoped' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.derive({ as: 'scoped' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()

			return {}
		})
		.resolve({ as: 'scoped' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()

			return {}
		})
		.onTransform({ as: 'scoped' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.onBeforeHandle({ as: 'scoped' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.onAfterHandle({ as: 'scoped' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.mapResponse({ as: 'scoped' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
		})
		.onAfterResponse({ as: 'scoped' }, ({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<
				Record<string, string>
			>()
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
		.onAfterResponse((ctx) => {
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
				resolve: async ({ query: { name = 'anon' } }) => ({
					user: {
						name,
						async: false
					} as const
				})
			}),
			asyncUser: (enabled: boolean) => ({
				resolve: async ({ query: { name = 'anon' } }) => ({
					user: {
						name,
						async: true
					} as const
				})
			})
		})
		.get(
			'/',
			({ user }) => {
				expectTypeOf<typeof user>().toEqualTypeOf<{
					readonly name: string
					readonly async: false
				}>()
			},
			{
				user: true
			}
		)
		.get(
			'/',
			({ user }) => {
				expectTypeOf<typeof user>().toEqualTypeOf<{
					readonly name: string
					readonly async: true
				}>()
			},
			{
				asyncUser: true
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
						error,
						cookie: { token },
						store: { session }
					}) {
						if (!token.value)
							return error(401, {
								success: false,
								message: 'Unauthorized'
							})

						expectTypeOf<typeof session>().toEqualTypeOf<
							Record<number, string>
						>()

						const username =
							session[token.value as unknown as number]

						if (!username)
							return error(401, {
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
		() => {
			return {
				name: 'a',
				a: 'b'
			}
		},
		{
			response: {
				200: t.Object({
					name: t.String()
				}),
				400: t.Object({
					name: t.String()
				})
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
		() => {
			return {
				name: 'a',
				a: 'b'
			}
		},
		{
			response: {
				400: t.Object({
					name: t.String()
				})
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
			({ cookie: { council } }) =>
				(council.value = [
					{
						name: 'Rin',
						affilation: 'Administration'
					}
				]),
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
			}
		)
		.get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
		.get('/multiple', ({ cookie: { name, president } }) => {
			name.value = 'Himari'
			president.value = 'Rio'

			return 'ok'
		})
		.get(
			'/update',
			({ cookie: { name } }) => {
				name.value = 'seminar: Himari'

				return name.value
			},
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
				resolve: () => ({
					a: 'a'
				})
			}
		})
		.get(
			'/a',
			({ a }) => {
				expectTypeOf<typeof a>().toEqualTypeOf<string>()
			},
			{
				a: true,
				beforeHandle: (c) => {}
			}
		)
		.ws('/', {
			a: true,
			message({ data: { a } }) {
				expectTypeOf<typeof a>().toEqualTypeOf<string>()
			}
		})
}

// Type AfterHandler according to known schema
{
	new Elysia().get('/', () => 'yay', {
		afterResponse({ response }) {
			expectTypeOf<typeof response>().toEqualTypeOf<string | number>()
		},
		response: {
			200: t.String(),
			400: t.Number()
		}
	})
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
	new Elysia().onError(({ status }) => {
		status(200)
	})
}

// onAfterHandle should have response
{
	new Elysia().onAfterHandle({ as: 'scoped' }, ({ response }) => response)
}

{
	new Elysia()
		.macro({
			a: {
				resolve: () => ({ a: 'a' as const })
			},
			b: {
				resolve: () => ({ b: 'b' as const })
			}
		})
		.get(
			'/test',
			(
				{
					a,
					b
				} /* Neither `a` or `b` exist at the type level, even though they do exist at runtime */
			) => ({ a, b }),
			{
				a: true,
				b: true
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
	new Elysia().get('/', () => '', {
		afterHandle: ({ status }) => status(201, { foo: 'bar' }),
		response: {
			201: t.Object({
				foo: t.String()
			})
		}
	})

	const route = new Elysia().get('/', () => ({ foo: 'a' }), {
		// @ts-expect-error
		afterHandle: () => ({ q: 'a' }),
		response: t.Object({
			foo: t.String()
		})
	})
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
		AsyncGenerator<
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

	const app = new Elysia().get('/', function () {
		return sse(a())
	})

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

// return async generator SSE type correctly
{
	async function* a() {
		yield 'a'
		yield 'b'
	}

	const app = new Elysia().get('/', function () {
		return sse(a())
	})

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

	const app = new Elysia().get('/', function () {
		return sse(undefined as any as ReadableStream<'a'>)
	})

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<
		AsyncGenerator<
			{
				readonly data: 'a'
			},
			void,
			unknown
		>
	>()
}

// infer ReadableStream to Iterable
{
	const app = new Elysia()
		.get('/', function () {
			return undefined as any as ReadableStream<'a'>
		})
		.listen(3000)

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<AsyncGenerator<'a', void, unknown>>()
}
