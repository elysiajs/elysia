import { expectTypeOf } from 'expect-type'
import { Elysia, macroType, t } from '../../src'
import type { MacroTypeLambda } from '../../src'

interface Descriptor {
	table: string
	id: string
}

interface TouchLambda extends MacroTypeLambda {
	option: (ctx: this['context']) => Descriptor
}

const touch = new Elysia({ name: 'touch' }).macro({
	touch: (fn: (ctx: any) => Descriptor) => ({
		$type: macroType<TouchLambda>(),
		beforeHandle() {}
	})
})

// The callback receives the route's own schema, path params and singleton.
{
	new Elysia()
		.use(touch)
		.decorate('db', 'sqlite' as const)
		.derive(() => ({ session: { userId: 'u1' } }))
		.post(
			'/todos/:listId',
			{
				body: t.Object({ ownerId: t.String() }),
				query: t.Object({ page: t.Number() }),
				headers: t.Object({ authorization: t.String() }),
				touch: (ctx) => {
					expectTypeOf(ctx).not.toBeAny()
					expectTypeOf(ctx.body).toEqualTypeOf<{ ownerId: string }>()
					expectTypeOf(ctx.params).toEqualTypeOf<{ listId: string }>()
					expectTypeOf(ctx.query).toEqualTypeOf<{ page: number }>()
					expectTypeOf(ctx.headers).toEqualTypeOf<{
						authorization: string
					}>()
					expectTypeOf(ctx.session).toEqualTypeOf<{
						readonly userId: 'u1'
					}>()
					expectTypeOf(ctx.db).toEqualTypeOf<'sqlite'>()

					// @ts-expect-error not in the body schema
					ctx.body.title
					// @ts-expect-error not a path param
					ctx.params.id
					// @ts-expect-error not derived or decorated
					ctx.user

					return { table: 'todo', id: ctx.body.ownerId }
				}
			},
			({ body }) => body.ownerId
		)
}

// Each call site gets its own context, wherever the option sits in the hook.
{
	new Elysia()
		.use(touch)
		.post(
			'/a',
			{
				touch: ({ body }) => {
					expectTypeOf(body).toEqualTypeOf<{ a: number }>()

					return { table: 'a', id: String(body.a) }
				},
				body: t.Object({ a: t.Number() })
			},
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ a: number }>()
			}
		)
		.put(
			'/b',
			{
				body: t.Object({ b: t.Boolean() }),
				touch: ({ body }) => {
					expectTypeOf(body).toEqualTypeOf<{ b: boolean }>()

					return { table: 'b', id: String(body.b) }
				}
			},
			() => 'ok'
		)
}

// The callback's return type is still checked.
{
	new Elysia().use(touch).post(
		'/',
		{
			body: t.Object({ id: t.String() }),
			// @ts-expect-error a Descriptor is required
			touch: ({ body }) => body.id
		},
		() => 'ok'
	)
}

// An object option can carry route-typed callbacks.
{
	interface LiveOption<Context> {
		topic?: (ctx: Context) => string
		vary?: (ctx: Context) => string
	}

	interface LiveLambda extends MacroTypeLambda {
		option: LiveOption<this['context']>
	}

	new Elysia()
		.macro({
			live: (option: LiveOption<any>) => ({
				$type: macroType<LiveLambda>(),
				beforeHandle() {}
			})
		})
		.get(
			'/room/:roomId',
			{
				query: t.Object({ cursor: t.String() }),
				live: {
					topic: ({ params }) => {
						expectTypeOf(params).toEqualTypeOf<{ roomId: string }>()

						// @ts-expect-error not a path param
						params.id

						return params.roomId
					},
					vary: ({ query }) => {
						expectTypeOf(query).toEqualTypeOf<{ cursor: string }>()

						return query.cursor
					}
				}
			},
			() => 'ok'
		)
		.get(
			'/bad',
			{
				live: {
					// @ts-expect-error topic must return a string
					topic: () => 1
				}
			},
			() => 'ok'
		)
}

// A union option reports an invalid property on the property, not the macro key.
{
	interface LiveOption<Context> {
		topic?: (ctx: Context) => string
		depend?: readonly string[]
	}

	interface LiveLambda extends MacroTypeLambda {
		option: true | LiveOption<this['context']> | false | undefined
	}

	interface TagLambda extends MacroTypeLambda {
		option: true | Record<string, (ctx: this['context']) => string>
	}

	new Elysia()
		.macro({
			live: (option: true | LiveOption<any> | false | undefined) => ({
				$type: macroType<LiveLambda>(),
				beforeHandle() {}
			}),
			tag: (option: true | Record<string, (ctx: any) => string>) => ({
				$type: macroType<TagLambda>(),
				beforeHandle() {}
			})
		})
		.get('/on', { live: true, tag: true }, () => 'ok')
		.get('/off', { live: false }, () => 'ok')
		.get(
			'/room/:roomId',
			{
				live: { topic: ({ params }) => params.roomId },
				tag: { room: ({ params }) => params.roomId }
			},
			() => 'ok'
		)
		.get(
			'/bad-topic',
			{
				live: {
					// @ts-expect-error topic must return a string
					topic: () => 1
				}
			},
			() => 'ok'
		)
		.get(
			'/bad-depend',
			{
				live: {
					// @ts-expect-error depend is a string array
					depend: [1]
				}
			},
			() => 'ok'
		)
		.guard({ live: true, tag: true })
}

// Error placement never changes which values are accepted.
{
	interface FixedLambda extends MacroTypeLambda {
		option: number | { toFixed: string }
	}

	interface UnknownLambda extends MacroTypeLambda {
		option: unknown
	}

	const brand: unique symbol = Symbol()
	type UserId = string & { [brand]: 'UserId' }

	interface BrandedLambda extends MacroTypeLambda {
		option: string | { [brand]: number }
	}

	new Elysia()
		.macro({
			branded: (option: string | { [brand]: number }) => ({
				$type: macroType<BrandedLambda>(),
				beforeHandle() {}
			}),
			fixed: (option: number | { toFixed: string }) => ({
				$type: macroType<FixedLambda>(),
				beforeHandle() {}
			}),
			loose: (option: unknown) => ({
				$type: macroType<UnknownLambda>(),
				beforeHandle() {}
			})
		})
		.get('/number', { fixed: 1, loose: null }, () => 'ok')
		.get('/branded', { branded: 'alice' as UserId }, () => 'ok')
		.get(
			'/object',
			{ fixed: { toFixed: 'x' }, loose: { n: null } },
			() => 'ok'
		)
		.get(
			'/bad',
			{
				fixed: {
					// @ts-expect-error toFixed is a string
					toFixed: 1
				}
			},
			() => 'ok'
		)
}

// Early returns without the marker keep the option lambda.
{
	interface KeyLambda extends MacroTypeLambda {
		option: ((ctx: this['context']) => string) | false
	}

	new Elysia()
		.macro({
			key: (fn: ((ctx: any) => string) | false) => {
				if (!fn) return {}

				return { $type: macroType<KeyLambda>(), beforeHandle() {} }
			}
		})
		.post(
			'/key/:id',
			{
				key: ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>()

					// @ts-expect-error not a path param
					params.nope

					return params.id
				}
			},
			() => 'ok'
		)
}

// One lambda can type the option and add handler context.
{
	interface ChannelOption<Context> {
		key: (ctx: Context) => string
	}

	interface ChannelLambda extends MacroTypeLambda {
		option: ChannelOption<this['context']>
		output: { channel: string }
	}

	new Elysia()
		.macro({
			channel: (option: ChannelOption<any>) => ({
				$type: macroType<ChannelLambda>(),
				derive: () => ({ channel: '' })
			})
		})
		.post(
			'/c',
			{
				body: t.Object({ room: t.String() }),
				channel: {
					key: ({ body }) => {
						expectTypeOf(body).toEqualTypeOf<{ room: string }>()

						return body.room
					}
				}
			},
			({ channel, body }) => {
				expectTypeOf(channel).toEqualTypeOf<string>()
				expectTypeOf(body).toEqualTypeOf<{ room: string }>()
			}
		)
}

// Output from macros selected at the same call site is not part of the
// option context.
{
	new Elysia()
		.use(touch)
		.macro({ auth: { derive: () => ({ user: 'alice' as const }) } })
		.post(
			'/mixed',
			{
				auth: true,
				body: t.Object({ id: t.String() }),
				touch: (ctx) => {
					// @ts-expect-error macro-derived values are not in the option context
					ctx.user

					return { table: 'mixed', id: ctx.body.id }
				}
			},
			({ user }) => {
				expectTypeOf(user).toEqualTypeOf<'alice'>()
			}
		)
}

// Macros that don't opt in keep their declared option type.
{
	new Elysia()
		.use(touch)
		.macro({
			role: (role: 'admin' | 'user') => ({ beforeHandle() {} }),
			flagged: {
				beforeHandle() {}
			}
		})
		.post('/plain', { role: 'admin', flagged: true }, () => 'ok')
		// @ts-expect-error not a declared role
		.post('/bad-role', { role: 'root' }, () => 'ok')
		// @ts-expect-error object-form macros take a boolean
		.post('/bad-flag', { flagged: () => 'x' }, () => 'ok')
}

// A lambda without `option` only adds context; the option keeps its declared type.
{
	interface TagLambda extends MacroTypeLambda {
		output: Record<'tagged', this['input']>
	}

	new Elysia()
		.macro({
			tag: (
				tag: 'a' | 'b'
			): { $type?: TagLambda; beforeHandle(): void } => ({
				beforeHandle() {}
			})
		})
		.post('/a', { tag: 'a' }, ({ tagged }) => {
			expectTypeOf(tagged).toEqualTypeOf<'a'>()
		})
		// @ts-expect-error not a declared tag
		.post('/c', { tag: 'c' }, () => 'ok')
}

// Object-form macros can't opt in: the value never reaches them at runtime.
{
	interface IgnoredLambda extends MacroTypeLambda {
		option: (ctx: this['context']) => string
	}

	const ignored: { $type?: IgnoredLambda; beforeHandle(): void } = {
		beforeHandle() {}
	}

	new Elysia()
		.macro({ ignored })
		.post('/ok', { ignored: true }, () => 'ok')
		// @ts-expect-error still a boolean option
		.post('/bad', { ignored: () => 'x' }, () => 'ok')
}

// Every HTTP verb carries the option context.
{
	new Elysia()
		.use(touch)
		.patch(
			'/patch/:id',
			{
				touch: ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>()

					return { table: 'patch', id: params.id }
				}
			},
			() => 'ok'
		)
		.delete(
			'/delete/:id',
			{
				touch: ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>()

					return { table: 'delete', id: params.id }
				}
			},
			() => 'ok'
		)
		.options(
			'/options/:id',
			{
				touch: ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>()

					return { table: 'options', id: params.id }
				}
			},
			() => 'ok'
		)
		.query(
			'/query/:id',
			{
				touch: ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>()

					return { table: 'query', id: params.id }
				}
			},
			() => 'ok'
		)
		.head(
			'/head/:id',
			{
				touch: ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>()

					return { table: 'head', id: params.id }
				}
			},
			() => 'ok'
		)
		.all(
			'/all/:id',
			{
				touch: ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>()

					return { table: 'all', id: params.id }
				}
			},
			() => 'ok'
		)
		.method(
			'SEARCH',
			'/search/:id',
			{
				touch: ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>()

					// @ts-expect-error not a path param
					params.nope

					return { table: 's', id: params.id }
				}
			},
			() => 'ok'
		)
}

// Guards type the option from the guard's schema and the singleton.
{
	new Elysia()
		.use(touch)
		.derive(() => ({ session: 'abc' as const }))
		.macro({ auth: { derive: () => ({ user: 'alice' as const }) } })
		.guard({
			auth: true,
			body: t.Object({ guarded: t.String() }),
			touch: (ctx) => {
				expectTypeOf(ctx.body).toEqualTypeOf<{ guarded: string }>()
				expectTypeOf(ctx.session).toEqualTypeOf<'abc'>()

				// @ts-expect-error not in the guard's body schema
				ctx.body.title
				// @ts-expect-error macro-derived values are not in the option context
				ctx.user

				return { table: 'g', id: ctx.body.guarded }
			}
		})

	new Elysia().use(touch).guard({
		schema: 'merge',
		query: t.Object({ page: t.Number() }),
		touch: ({ query }) => {
			expectTypeOf(query).toEqualTypeOf<{ page: number }>()

			return { table: 'g', id: String(query.page) }
		}
	})

	new Elysia().use(touch).guard('plugin', {
		headers: t.Object({ authorization: t.String() }),
		touch: ({ headers }) => {
			expectTypeOf(headers).toEqualTypeOf<{ authorization: string }>()

			return { table: 'g', id: headers.authorization }
		}
	})

	new Elysia().use(touch).guard(
		{
			body: t.Object({ scoped: t.Number() }),
			touch: ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ scoped: number }>()

				return { table: 'g', id: String(body.scoped) }
			}
		},
		(app) => app.post('/scoped', ({ body }) => body.scoped)
	)
}

// Each guard overload carries the option context.
{
	const body = t.Object({ n: t.Number() })

	new Elysia()
		.use(touch)
		.guard(
			{
				schema: 'merge',
				body,
				touch: ({ body }) => {
					expectTypeOf(body).toEqualTypeOf<{ n: number }>()

					return { table: 'n', id: String(body.n) }
				}
			},
			(app) => app
		)
		.guard('local', {
			body,
			touch: ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ n: number }>()

				return { table: 'n', id: String(body.n) }
			}
		})
		.guard('local', {
			schema: 'merge',
			body,
			touch: ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ n: number }>()

				return { table: 'n', id: String(body.n) }
			}
		})
		.guard('plugin', {
			schema: 'merge',
			body,
			touch: ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ n: number }>()

				return { table: 'n', id: String(body.n) }
			}
		})
		.guard('global', {
			body,
			touch: ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ n: number }>()

				return { table: 'n', id: String(body.n) }
			}
		})
		.guard('global', {
			schema: 'merge',
			body,
			touch: ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ n: number }>()

				return { table: 'n', id: String(body.n) }
			}
		})
		.group(
			'/merge',
			{
				schema: 'merge',
				body,
				touch: ({ body }) => {
					expectTypeOf(body).toEqualTypeOf<{ n: number }>()

					return { table: 'n', id: String(body.n) }
				}
			},
			(app) => app
		)

	new Elysia().use(touch).guard('local', {
		body,
		// @ts-expect-error the guard body has no `x`
		touch: ({ body }) => ({ table: 'n', id: body.x })
	})
}

// A later guard's option sees its own schema, not an earlier guard's.
{
	new Elysia()
		.use(touch)
		.guard({ body: t.Object({ a: t.String() }) })
		.guard(
			{
				body: t.Object({ b: t.Number() }),
				touch: ({ body }) => {
					expectTypeOf(body).toEqualTypeOf<{ b: number }>()

					// @ts-expect-error replaced by the later guard's body
					body.a

					return { table: 'b', id: String(body.b) }
				}
			},
			(app) => app
		)
}

// A later callback guard defines every route schema slot.
{
	const a = t.Object({ a: t.String() })
	const b = t.Object({ b: t.Number() })

	const callback = new Elysia()
		.guard({
			body: a,
			headers: a,
			query: a,
			params: a,
			cookie: a,
			response: a
		})
		.guard(
			{
				body: b,
				headers: b,
				query: b,
				params: b,
				cookie: b,
				response: b
			},
			(app) =>
				app.post('/', ({ body, headers, query, params, cookie }) => {
					expectTypeOf(body).toEqualTypeOf<{ b: number }>()
					expectTypeOf(headers).toEqualTypeOf<{ b: number }>()
					expectTypeOf(query).toEqualTypeOf<{ b: number }>()
					expectTypeOf(params).toEqualTypeOf<{ b: number }>()
					expectTypeOf(cookie.b.value).toEqualTypeOf<number>()

					return { b: body.b }
				})
		)

	expectTypeOf<
		(typeof callback)['~Routes']['post']['response'][200]
	>().toEqualTypeOf<{ b: number }>()
}

// Chained guards without a callback keep the same nearest-schema precedence.
{
	new Elysia()
		.guard({ body: t.Object({ a: t.String() }) })
		.guard({ body: t.Object({ b: t.Number() }) })
		.post('/', ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ b: number }>()
		})
}

// Schema-bearing groups use their own schema over an inherited guard schema.
{
	new Elysia()
		.guard({ body: t.Object({ a: t.String() }) })
		.group('/group', { body: t.Object({ b: t.Number() }) }, (app) =>
			app.post('/', ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ b: number }>()
			})
		)
}

// Merge guards remain additive inside callbacks.
{
	new Elysia().guard({ body: t.Object({ a: t.String() }) }).guard(
		{
			schema: 'merge',
			body: t.Object({ b: t.Number() })
		},
		(app) =>
			app.post('/', ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{
					a: string
					b: number
				}>()
			})
	)
}

// A guard added inside a callback is nearer than the callback's own schema,
// at every scope.
{
	const b = t.Object({ b: t.Number() })
	const c = t.Object({ c: t.Boolean() })

	new Elysia().guard({ body: b }, (app) =>
		app.guard('plugin', { body: c }).post('/', ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ c: boolean }>()
		})
	)

	new Elysia().guard({ body: b }, (app) =>
		app.guard('global', { body: c }).post('/', ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ c: boolean }>()
		})
	)

	new Elysia().guard({ body: b }, (app) =>
		app
			.use(new Elysia().guard('plugin', { body: c }))
			.post('/', ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ c: boolean }>()
			})
	)
}

// A group prefix keeps its path params alongside the group's own schema.
{
	new Elysia()
		.guard({ body: t.Object({ a: t.String() }) })
		.group('/user/:id', { body: t.Object({ b: t.Number() }) }, (app) =>
			app.post('/', ({ params, body }) => {
				expectTypeOf(params).toEqualTypeOf<{ id: string }>()
				expectTypeOf(body).toEqualTypeOf<{ b: number }>()
			})
		)
}

// An inherited params schema wins over params derived from a prefix, in
// lifecycle hooks as well as handlers.
{
	const params = t.Object({ id: t.Numeric() })

	new Elysia().guard({ params }).group('/user/:id', {}, (app) =>
		app
			.onBeforeHandle(({ params }) => {
				expectTypeOf(params).toEqualTypeOf<{ id: number }>()
			})
			.derive(({ params }) => {
				expectTypeOf(params).toEqualTypeOf<{ id: number }>()

				return {}
			})
			.get('/', ({ params }) => {
				expectTypeOf(params).toEqualTypeOf<{ id: number }>()
			})
	)

	new Elysia({ prefix: '/user/:id' }).guard({ params }).guard({}, (app) =>
		app
			.onBeforeHandle(({ params }) => {
				expectTypeOf(params).toEqualTypeOf<{ id: number }>()
			})
			.derive(({ params }) => {
				expectTypeOf(params).toEqualTypeOf<{ id: number }>()

				return {}
			})
			.get('/', ({ params }) => {
				expectTypeOf(params).toEqualTypeOf<{ id: number }>()
			})
	)

	new Elysia().group('/user/:id', {}, (app) =>
		app.onBeforeHandle(({ params }) => {
			expectTypeOf(params).toEqualTypeOf<{ id: string }>()
		})
	)
}

// Output from macros on an earlier call site is accumulated context, so a
// later option sees it.
{
	new Elysia()
		.use(touch)
		.macro({ auth: { derive: () => ({ user: 'alice' as const }) } })
		.guard({ auth: true })
		.post(
			'/inherited',
			{
				touch: (ctx) => {
					expectTypeOf(ctx.user).toEqualTypeOf<'alice'>()

					return { table: 'user', id: ctx.user }
				}
			},
			() => 'ok'
		)
		.guard({
			touch: (ctx) => {
				expectTypeOf(ctx.user).toEqualTypeOf<'alice'>()

				return { table: 'user', id: ctx.user }
			}
		})
}

// A schema-bearing group sees its prefix params.
{
	new Elysia()
		.use(touch)
		.decorate('db', 'sqlite' as const)
		.group(
			'/org/:orgId',
			{
				query: t.Object({ page: t.Number() }),
				touch: (ctx) => {
					expectTypeOf(ctx.params).toEqualTypeOf<{ orgId: string }>()
					expectTypeOf(ctx.query).toEqualTypeOf<{ page: number }>()
					expectTypeOf(ctx.db).toEqualTypeOf<'sqlite'>()

					// @ts-expect-error not a prefix param
					ctx.params.id
					// @ts-expect-error not derived or decorated
					ctx.user

					return { table: 'org', id: ctx.params.orgId }
				}
			},
			(app) => app.get('/', () => 'ok')
		)
}

// Both WebSocket option overloads type the option from the upgrade route.
{
	new Elysia()
		.use(touch)
		.derive(() => ({ session: 'abc' as const }))
		.ws('/room/:roomId', {
			query: t.Object({ cursor: t.String() }),
			touch: (ctx) => {
				expectTypeOf(ctx.params).toEqualTypeOf<{ roomId: string }>()
				expectTypeOf(ctx.query).toEqualTypeOf<{ cursor: string }>()
				expectTypeOf(ctx.session).toEqualTypeOf<'abc'>()

				// @ts-expect-error not a path param
				ctx.params.id
				// @ts-expect-error not derived or decorated
				ctx.user

				return { table: 'room', id: ctx.params.roomId }
			},
			message() {}
		})
		.ws(
			'/chat/:chatId',
			{
				body: t.Object({ text: t.String() }),
				touch: ({ params, body }) => {
					expectTypeOf(params).toEqualTypeOf<{ chatId: string }>()
					expectTypeOf(body).toEqualTypeOf<{ text: string }>()

					return { table: 'chat', id: params.chatId }
				}
			},
			(ws, message) => {
				expectTypeOf(message).toEqualTypeOf<{ text: string }>()
			}
		)
}

// Eden's view of the route is unchanged by the option.
{
	const withOption = new Elysia().use(touch).post(
		'/todos/:id',
		{
			body: t.Object({ title: t.String() }),
			touch: ({ params }) => ({ table: 'todo', id: params.id })
		},
		({ body }) => ({ title: body.title })
	)

	const withoutOption = new Elysia()
		.use(touch)
		.post(
			'/todos/:id',
			{ body: t.Object({ title: t.String() }) },
			({ body }) => ({ title: body.title })
		)

	type With = (typeof withOption)['~Routes']['todos'][':id']['post']
	type Without = (typeof withoutOption)['~Routes']['todos'][':id']['post']

	expectTypeOf<With['body']>().toEqualTypeOf<{ title: string }>()
	expectTypeOf<With['params']>().toEqualTypeOf<{ id: string }>()
	expectTypeOf<With['response'][200]>().toEqualTypeOf<{ title: string }>()
	expectTypeOf<With['body']>().toEqualTypeOf<Without['body']>()
	expectTypeOf<With['params']>().toEqualTypeOf<Without['params']>()
	expectTypeOf<With['response']>().toEqualTypeOf<Without['response']>()
}
