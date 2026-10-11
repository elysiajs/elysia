import { Elysia, t, type MacroToContext } from '../../src'
import type { CreateEdenResponse } from '../../src/types'
import { expectTypeOf } from 'expect-type'

// guard handle resolve macro
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				derive: () => ({
					account: 'A'
				})
			})
		})
		.guard({
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// guard handle resolve macro with scoped
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				derive: () => ({
					account: 'A'
				})
			})
		})
		.guard('plugin', {
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// guard handle resolve macro with global
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				derive: () => ({
					account: 'A'
				})
			})
		})
		.guard('global', {
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})
}

// guard handle resolve macro with local
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				derive: () => ({
					account: 'A'
				})
			})
		})
		.guard('local', {
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// `.guard(scope, hooks)` applies macro-derived values at the selected scope.
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				derive: () => ({
					account: 'A'
				})
			})
		})
		.guard('plugin', {
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				derive: () => ({
					account: 'A'
				})
			})
		})
		.guard('global', {
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})
}

{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				derive: () => ({
					account: 'A'
				})
			})
		})
		.guard('local', {
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// `.guard(scope, hooks)` applies hook schemas at the selected scope.
{
	const plugin = new Elysia()
		.guard('plugin', {
			query: t.Object({ name: t.String() })
		})
		.get('/', ({ query }) => {
			expectTypeOf(query).toEqualTypeOf<{ name: string }>()
		})

	const parent = new Elysia().use(plugin).get('/', ({ query }) => {
		expectTypeOf(query).toEqualTypeOf<{ name: string }>()
	})

	const app = new Elysia().use(parent).get('/', ({ query }) => {
		expectTypeOf(query).toEqualTypeOf<Record<string, string | undefined>>()
	})
}

// guard handle resolve macro with error
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				derive: ({ status }) => {
					if (Math.random() > 0.5) return status(401)

					return {
						account: 'A'
					}
				}
			})
		})
		.guard({
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// guard handle resolve macro with async
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				derive: async ({ status }) => {
					if (Math.random() > 0.5) return status(401)

					return {
						account: 'A'
					}
				}
			})
		})
		.guard('plugin', {
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// Handle ephemeral and volatile property
{
	const app = new Elysia()
		.derive(() => {
			return {
				hello: 'world'
			}
		})
		.macro({
			user: (enabled: boolean) => ({
				derive: ({ hello, query: { name = 'anon' } }) => {
					expectTypeOf(hello).toEqualTypeOf<'world' | undefined>()

					return {
						user: {
							name
						}
					}
				}
			})
		})
		.get(
			'/',
			{
				user: true
			},
			({ user }) => user
		)
}

// Handle shorthand function macro
{
	const app = new Elysia()
		.macro({
			user: {
				derive: ({ query: { name = 'anon' } }) => ({
					user: {
						name
					}
				})
			}
		})
		.get(
			'/',
			{
				user: true
			},
			({ user }) => {
				expectTypeOf(user).toEqualTypeOf<{ name: string }>()
			}
		)
		.get(
			'/no',
			{
				user: false
			},
			(context) => {
				expectTypeOf(context).not.toHaveProperty('user')
			}
		)
}

// resolve with custom status
{
	const app = new Elysia()
		.macro({
			auth: {
				derive: [
					({ status }) => {
						if (Math.random() > 0.5) return status(401)

						return { user: 'saltyaom' } as const
					}
				]
			}
		})
		.get(
			'/',
			{
				auth: true
			},
			({ user }) => user
		)
}

// retrieve resolve conditionally
const app = new Elysia()
	.macro({
		user: (enabled: true) => ({
			derive() {
				if (!enabled) return

				return {
					user: 'a'
				}
			}
		})
	})
	.get(
		'/',
		{
			user: true
		},
		({ user, status }) => {
			if (!user) return status(401)

			return { hello: 'hanabi' }
		}
	)

// Macro hooks receive their own schema; inheriting routes receive both schemas.
{
	new Elysia()
		.macro({
			a: {
				body: t.Object({ a: t.Literal('A') }),
				beforeHandle({ body }) {
					expectTypeOf(body).toEqualTypeOf<{ a: 'A' }>()
				}
			}
		})
		.macro({
			b: {
				a: true,
				body: t.Object({ b: t.Literal('B') }),
				beforeHandle({ body }) {
					expectTypeOf(body).toEqualTypeOf<{ b: 'B' }>()
				}
			}
		})
		.post('/', { b: true }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ b: 'B'; a: 'A' }>()
		})
}

// A macro's schema still reaches the handler when a schema-less macro is
// enabled beside it. Eden already requires `friends` from the client, so a
// handler typed without it would disagree with what the route validates.
{
	const app = new Elysia()
		.macro({
			withFriends: {
				body: t.Object({ friends: t.Array(t.String()) }),
				query: t.Object({ page: t.String() }),
				meta: { friends: true }
			},
			flag: { beforeHandle() {} },
			withUser: { derive: () => ({ user: 'saltyaom' as const }) },
			// Own schema plus a nested schema-less macro
			withTag: {
				flag: true,
				body: t.Object({ tag: t.String() })
			}
		})
		.post(
			'/one',
			{ withFriends: true, body: t.Object({ name: t.String() }) },
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{
					name: string
					friends: string[]
				}>()
			}
		)
		.post('/two', { withFriends: true, flag: true }, ({ body, query }) => {
			expectTypeOf(body).toEqualTypeOf<{ friends: string[] }>()
			expectTypeOf(query).toEqualTypeOf<{ page: string }>()
		})
		.post(
			'/two-route-body',
			{
				flag: true,
				withFriends: true,
				body: t.Object({ name: t.String() })
			},
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{
					name: string
					friends: string[]
				}>()
			}
		)
		.post(
			'/three',
			{ withFriends: true, flag: true, withUser: true },
			({ body, user }) => {
				expectTypeOf(body).toEqualTypeOf<{ friends: string[] }>()
				expectTypeOf(user).toEqualTypeOf<'saltyaom'>()
			}
		)
		.post('/nested', { withTag: true }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ tag: string }>()
		})

	expectTypeOf<
		(typeof app)['~Routes']['two-route-body']['post']['body']
	>().toEqualTypeOf<{ name: string; friends: string[] }>()
	expectTypeOf<
		(typeof app)['~Routes']['two']['post']['meta']
	>().toEqualTypeOf<{ readonly friends: true }>()
}

// Different literal metas (`'a'` vs `'b'`, null vs object) are a valid route,
// but intersecting them makes TypeScript reduce the whole combined macro
// context to never, erasing every schema and derive the macros contribute.
{
	const app = new Elysia()
		.macro({
			a: {
				body: t.Object({ name: t.String() }),
				query: t.Object({ page: t.String() }),
				meta: 'a'
			},
			b: {
				body: t.Object({ name: t.String() }),
				query: t.Object({ page: t.String() }),
				meta: 'b'
			},
			nullMeta: { meta: null },
			objectMeta: { meta: { x: 1 } },
			withUser: { derive: () => ({ user: 'saltyaom' as const }) },
			// Own meta conflicts with the nested macro's meta
			nested: {
				meta: 'nested',
				a: true,
				derive: () => ({ role: 'admin' as const })
			}
		})
		.post('/meta-literal', { a: true, b: true }, ({ body, query }) => {
			expectTypeOf(body).toEqualTypeOf<{ name: string }>()
			expectTypeOf(query).toEqualTypeOf<{ page: string }>()
		})
		.post(
			'/meta-null',
			{ nullMeta: true, objectMeta: true, withUser: true, a: true },
			({ body, user }) => {
				expectTypeOf(body).toEqualTypeOf<{ name: string }>()
				expectTypeOf(user).toEqualTypeOf<'saltyaom'>()
			}
		)
		.post('/meta-nested', { nested: true }, ({ body, role }) => {
			expectTypeOf(body).toEqualTypeOf<{ name: string }>()
			expectTypeOf(role).toEqualTypeOf<'admin'>()
		})

	expectTypeOf<
		(typeof app)['~Routes']['meta-literal']['post']['body']
	>().toEqualTypeOf<{ name: string }>()
	expectTypeOf<
		(typeof app)['~Routes']['meta-literal']['post']['query']
	>().toEqualTypeOf<{ page: string }>()
}

// Exported context types carry meta as declared: `MacroToContext` is public
// and `CreateEdenResponse` is emitted in the .d.ts, so an internal wrapper
// must not leak into either.
{
	expectTypeOf<
		MacroToContext<{ m: { meta: { x: 1 } } }, { m: true }>['meta']
	>().toEqualTypeOf<{ x: 1 }>()
	expectTypeOf<
		CreateEdenResponse<
			'/',
			{},
			{ body: unknown; meta: { x: 1 } },
			{}
		>['meta']
	>().toEqualTypeOf<{ x: 1 }>()
}

// A macro's union or optional body keeps its shape, like a route's own body.
// Bodies of different macros intersect, since every macro's validator runs.
{
	new Elysia()
		.macro({
			either: {
				body: t.Union([
					t.Object({ a: t.String() }),
					t.Object({ b: t.Number() })
				])
			},
			maybe: { body: t.Optional(t.Object({ c: t.String() })) },
			withC: { body: t.Object({ c: t.String() }) },
			flag: { beforeHandle() {} }
		})
		.post('/union', { either: true }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ a: string } | { b: number }>()
		})
		.post('/optional', { maybe: true }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<
				{ c?: string | undefined } | null | undefined
			>()
		})
		.post('/union-flag', { either: true, flag: true }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ a: string } | { b: number }>()
		})
		.post('/optional-flag', { maybe: true, flag: true }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<
				{ c?: string | undefined } | null | undefined
			>()
		})
		.post('/union-body', { either: true, withC: true }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<
				{ a: string; c: string } | { b: number; c: string }
			>()
		})
		.post('/optional-body', { maybe: true, withC: true }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ c: string }>()
		})
}

// handle function
{
	new Elysia()
		.macro({
			a: (a: 'a') => ({
				derive: () => ({ a: 'a' as const })
			})
		})
		.get(
			'/',
			{
				a: 'a'
			},
			({ a }) => {
				expectTypeOf(a).toEqualTypeOf<'a'>()

				return a
			}
		)
		.get(
			'/',
			{
				// @ts-expect-error macro `a` accepts only the literal "a"
				a: 'b'
			},
			'ok'
		)
		.listen(3000)
}

// Function-form macros require their declared option type.
{
	new Elysia()
		.macro({
			level: (_opt: { min: number }) => ({
				beforeHandle() {}
			})
		})
		.get('/ok', { level: { min: 1 } }, 'ok')
		.get(
			'/bad-bool',
			{
				// @ts-expect-error boolean is not assignable to { min: number }
				level: true
			},
			'ok'
		)
		.get(
			'/bad-shape',
			{
				// @ts-expect-error wrong option shape
				level: { min: 'high' }
			},
			'ok'
		)
}

// Macro lifecycle handlers may return values alongside a response schema.
{
	new Elysia().macro({
		ok: {
			response: t.Object({ ok: t.Boolean() }),
			beforeHandle() {
				return { ok: true }
			}
		}
	})
}

// A route sees values derived through an inherited macro.
{
	new Elysia()
		.macro({
			auth: {
				derive: () => ({ userId: 1 })
			}
		})
		.macro({
			admin: {
				auth: true
			}
		})
		.get('/', { admin: true }, (ctx) => {
			expectTypeOf(ctx.userId).toEqualTypeOf<number>()
			return ctx.userId
		})
}
