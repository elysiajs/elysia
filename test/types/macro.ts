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
