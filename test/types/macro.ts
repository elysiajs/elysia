import { Elysia, t } from '../../src'
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
		.guard({
			as: 'plugin',
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
		.guard({
			as: 'global',
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
		.guard({
			as: 'local',
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

// string-scope guard twins of the `{ as: scope }` cases above — the
// `.guard(scope, hook)` form must apply macro context with the same
// scope-correct propagation
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

// string-scope guard also accumulates the hook's SCHEMA with scope-correct
// propagation
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
		expectTypeOf(query).toEqualTypeOf<Record<string, string>>()
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
		.guard({
			as: 'plugin',
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
		.get('/', ({ user }) => user, {
			user: true
		})
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
			({ user }) => {
				expectTypeOf(user).toEqualTypeOf<{ name: string }>()
			},
			{
				user: true
			}
		)
		.get(
			'/no',
			(context) => {
				expectTypeOf(context).not.toHaveProperty('user')
			},
			{
				user: false
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
		.get('/', ({ user }) => user, {
			auth: true
		})
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
		({ user, status }) => {
			if (!user) return status(401)

			return { hello: 'hanabi' }
		},
		{
			user: true
		}
	)

// Macro name extends macro. The definition's OWN handlers see only the
// definition's own schema (cross-macro context cannot be threaded into the
// own-handler ctx without collapsing the object-form inference) — the
// CONSUMING route sees the full merged schema via macroFn recursion
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
		.post(
			'/',
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ b: 'B'; a: 'A' }>()
			},
			{ b: true }
		)
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
			({ a }) => {
				expectTypeOf(a).toEqualTypeOf<'a'>()

				return a
			},
			{
				a: 'a'
			}
		)
		.get('/', 'ok', {
			// @ts-expect-error
			a: 'b'
		})
		.listen(3000)
}

// Function-form macro: the call-site value is the option object, not a boolean.
// Guards the parameterised-macro overload from regressing to the old
// boolean-accepting form (a `true` / wrong-shape must error).
{
	new Elysia()
		.macro({
			level: (_opt: { min: number }) => ({
				beforeHandle() {}
			})
		})
		.get('/ok', 'ok', { level: { min: 1 } })
		.get('/bad-bool', 'ok', {
			// @ts-expect-error boolean is not assignable to { min: number }
			level: true
		})
		.get('/bad-shape', 'ok', {
			// @ts-expect-error wrong option shape
			level: { min: 'high' }
		})
}

// A macro's declared `response` types the CONSUMING route's contract; the
// macro's OWN lifecycle handlers are NOT constrained by it — their actual
// returns (any value or status) are collected additively into the route's
// response union instead (see the bounded-status soundness suite)
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

// Inherited derive flows two hops: macro `auth` derives `userId`, macro
// `admin` applies `{ auth: true }`, and a route applying `{ admin: true }`
// sees it. Guards the recursive macro-inheritance derive path. (The derive
// is NOT visible to admin's OWN handlers — cross-macro context cannot reach
// the own-handler ctx in the object form.)
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
		.get(
			'/',
			(ctx) => {
				expectTypeOf(ctx.userId).toEqualTypeOf<number>()
				return ctx.userId
			},
			{ admin: true }
		)
}
