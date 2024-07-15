/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect } from 'bun:test'
import { t, Elysia, RouteSchema, Cookie, error } from '../../src'
import { expectTypeOf } from 'expect-type'

const app = new Elysia()

// ? default value of context
app.get('/', ({ headers, query, params, body, store }) => {
	// ? default keyof params should be never
	expectTypeOf<typeof params>().toBeNever()

	// ? default headers should be Record<string, unknown>
	expectTypeOf<typeof headers>().toEqualTypeOf<
		Record<string, string | undefined>
	>()

	// ? default query should be Record<string, unknown>
	expectTypeOf<typeof query>().toEqualTypeOf<
		Record<string, string | string[] | undefined>
	>()

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

	expectTypeOf<(typeof app)['decorator']['a']>().toEqualTypeOf<{
		readonly hello: {
			readonly cookie: 'wah!'
			readonly world: 'Tako'
		}
	}>()
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

	expect(app.decorator.hello).toEqual({
		world: 'Ina',
		cookie: 'wah!'
	})
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

	expectTypeOf<(typeof app)['store']['a']>().toEqualTypeOf<{
		hello: {
			world: string
			cookie: string
		}
	}>()
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

	expect(app.store.hello).toEqual({
		world: 'Ina',
		cookie: 'wah!'
	})
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

	type App = (typeof server)['_routes']
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

	type App = (typeof server)['_routes']
	type Route = App['index']['get']

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
	type App = (typeof server)['_routes']
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

	type App = (typeof server)['_routes']
	type Route = App['index']['get']

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

	type App = (typeof server)['_routes']
	type Route = App['index']['get']

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

// ? Inherits plugin prefix path
{
	const plugin = new Elysia({
		prefix: '/plugin',
		scoped: false
	}).get('/test-path', () => 'Test')

	const app = new Elysia({
		prefix: '/api',
		scoped: false
	})
		.use(plugin)
		.get('/a', () => 'A')

	type Routes = keyof (typeof app)['_routes']

	// expectTypeOf<Routes>().toEqualTypeOf<'/api/a' | '/api/plugin/test-path'>()
}

// ? Inherits plugin instance prefix
{
	const plugin = new Elysia({
		prefix: '/v1',
		scoped: false
	}).get('', () => 'hello')

	const server = app.use(plugin)

	type App = (typeof server)['_routes']
	type Route = App['v1']['get']

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

// ? Inlining function callback don't repeat prefix
{
	const test = (app: Elysia) =>
		app.group('/app', (group) => group.get('/test', () => 'test'))

	const app = new Elysia().use(test)

	type App = (typeof app)['_routes']
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

	type App = (typeof main)['_routes']

	expectTypeOf<keyof (typeof main)['_routes']>().toEqualTypeOf<'child'>()
	expectTypeOf<
		keyof (typeof main)['_types']['Singleton']['decorator']
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

app.resolve(({ headers }) => {
	return {
		authorization: headers.authorization as string
	}
})
	.get('/', ({ authorization }) => {
		// ? infers derive type
		expectTypeOf<typeof authorization>().toBeString()
	})
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

	expectTypeOf<(typeof app)['_routes']>().toEqualTypeOf<{
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

	type app = typeof app._routes

	expectTypeOf<app['index']['get']['response']>().toEqualTypeOf<{
		200: string
	}>()

	expectTypeOf<app['index']['post']['response']>().toEqualTypeOf<{
		201: string
	}>()

	expectTypeOf<app['true']['get']['response']>().toEqualTypeOf<{
		200: boolean
	}>()

	expectTypeOf<app['true']['post']['response']>().toEqualTypeOf<{
		202: boolean
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
			return Bun.file('test/kyuukurarin.mp4')
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
				a: Bun.file('test/kyuukurarin.mp4')
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
