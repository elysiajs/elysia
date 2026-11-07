import { Elysia, t } from '../../src'
import { expectTypeOf } from 'expect-type'

// Guard and group hooks receive values derived by the instance and its macros.
{
	new Elysia()
		.macro({
			auth: (enabled: boolean) => ({
				derive: () => ({ user: 'saltyaom' as const })
			})
		})
		.derive(() => ({ traceId: 'x' as const }))
		.guard({
			auth: true,
			beforeHandle: (ctx) => {
				expectTypeOf(ctx.user).toEqualTypeOf<'saltyaom'>()
				expectTypeOf(ctx.traceId).toEqualTypeOf<'x'>()
			},
			afterHandle: (ctx) => {
				expectTypeOf(ctx.user).toEqualTypeOf<'saltyaom'>()
				expectTypeOf(ctx.traceId).toEqualTypeOf<'x'>()
			},
			error: (ctx) => {
				// Error hooks omit values that may not have been derived yet.
				expectTypeOf(ctx).not.toHaveProperty('traceId')
			}
		})
}

// Group hook handlers receive instance-derived values.
{
	new Elysia()
		.derive(() => ({ traceId: 'x' as const }))
		.group(
			'/v1',
			{
				beforeHandle: (ctx) => {
					expectTypeOf(ctx.traceId).toEqualTypeOf<'x'>()
				}
			},
			(app) => app.get('/ok', () => 'ok')
		)
}

// `derive` (instance or macro) runs in beforeHandle, after parse and
// transform: at runtime its keys are undefined there, so they must not be
// typed. Decorators and store are set before any hook and stay
{
	new Elysia()
		.decorate('decorated', 'd' as const)
		.state('stored', 's' as const)
		.macro({ auth: { derive: () => ({ user: 'alice' as const }) } })
		.derive(() => ({ traceId: 'x' as const }))
		.parser('custom', (ctx) => {
			expectTypeOf(ctx).not.toHaveProperty('traceId')
			expectTypeOf(ctx.decorated).toEqualTypeOf<'d'>()
		})
		.onParse((ctx) => {
			expectTypeOf(ctx).not.toHaveProperty('traceId')
			expectTypeOf(ctx.decorated).toEqualTypeOf<'d'>()
			expectTypeOf(ctx.store.stored).toEqualTypeOf<'s'>()
		})
		.onTransform((ctx) => {
			expectTypeOf(ctx).not.toHaveProperty('traceId')
			expectTypeOf(ctx.decorated).toEqualTypeOf<'d'>()
			expectTypeOf(ctx.store.stored).toEqualTypeOf<'s'>()
		})
		.onTransform('global', (ctx) => {
			expectTypeOf(ctx).not.toHaveProperty('traceId')
		})
		.guard({
			auth: true,
			transform: (ctx) => {
				expectTypeOf(ctx).not.toHaveProperty('traceId')
				expectTypeOf(ctx).not.toHaveProperty('user')
			},
			beforeHandle: (ctx) => {
				expectTypeOf(ctx.traceId).toEqualTypeOf<'x'>()
				expectTypeOf(ctx.user).toEqualTypeOf<'alice'>()
			}
		})
		.get(
			'/',
			{
				auth: true,
				parse: (ctx) => {
					expectTypeOf(ctx).not.toHaveProperty('traceId')
					expectTypeOf(ctx).not.toHaveProperty('user')
				},
				transform: (ctx) => {
					expectTypeOf(ctx).not.toHaveProperty('traceId')
					expectTypeOf(ctx).not.toHaveProperty('user')
					expectTypeOf(ctx.decorated).toEqualTypeOf<'d'>()
				},
				beforeHandle: (ctx) => {
					expectTypeOf(ctx.traceId).toEqualTypeOf<'x'>()
					expectTypeOf(ctx.user).toEqualTypeOf<'alice'>()
				}
			},
			({ traceId, user }) => traceId + user
		)

	new Elysia()
		.derive(() => ({ traceId: 'x' as const }))
		.macro({
			withTransform: {
				transform: (ctx) => {
					expectTypeOf(ctx).not.toHaveProperty('traceId')
				}
			}
		})
}

// parse and transform run before validation and coercion: query, headers
// and params are what arrived (strings), the body is unvalidated (parse runs
// before it is even parsed). Same for a route's, a guard's and a macro's,
// as instance `.onParse()`/`.onTransform()`
{
	new Elysia()
		.guard({
			query: t.Object({ n: t.Number() }),
			transform: ({ query }) => {
				expectTypeOf(query.n).toEqualTypeOf<string | undefined>()
			}
		})
		.macro({
			m: {
				query: t.Object({ k: t.Number() }),
				transform: ({ query }) => {
					expectTypeOf(query.k).toEqualTypeOf<string | undefined>()
				}
			}
		})
		.post(
			'/t/:id/:opt?',
			{
				m: true,
				params: t.Object({
					id: t.Number(),
					opt: t.Optional(t.Number())
				}),
				body: t.Object({ b: t.Number() }),
				headers: t.Object({ 'x-n': t.Numeric() }),
				parse: ({ body, query }) => {
					expectTypeOf(body).toBeUnknown()
					expectTypeOf(query.n).toEqualTypeOf<string | undefined>()
				},
				transform: ({ body, query, params, headers }) => {
					expectTypeOf(body).toBeUnknown()
					expectTypeOf(query.n).toEqualTypeOf<string | undefined>()
					expectTypeOf(params).toEqualTypeOf<{
						id: string
						opt?: string
					}>()
					expectTypeOf(headers['x-n']).toEqualTypeOf<
						string | undefined
					>()
				},
				// validated from here on: unchanged
				beforeHandle: ({ query, params, body }) => {
					expectTypeOf(query.n).toEqualTypeOf<number>()
					expectTypeOf(params.id).toEqualTypeOf<number>()
					expectTypeOf(body.b).toEqualTypeOf<number>()
				}
			},
			({ query }) => query.n + query.k
		)
}

// The raw query is parsed by its schema's shape before validation: an array
// key is always an array (`?tags=a&tags=b` -> ['a', 'b']), an object one may
// be JSON-parsed, the rest is the last value as a string. And the cookie jar
// is built after parse and transform: `cookie` is undefined there
{
	new Elysia()
		.onParse((ctx) => {
			expectTypeOf(ctx.cookie).toBeUndefined()
		})
		.onTransform((ctx) => {
			expectTypeOf(ctx.cookie).toBeUndefined()
		})
		.guard({
			cookie: t.Cookie({ a: t.Optional(t.String()) }),
			transform: (ctx) => {
				expectTypeOf(ctx.cookie).toBeUndefined()
			}
		})
		.get(
			'/',
			{
				query: t.Object({
					tags: t.Array(t.String()),
					either: t.Union([t.String(), t.Array(t.String())]),
					o: t.ObjectString({ a: t.Number() }),
					n: t.Numeric()
				}),
				parse: (ctx) => {
					expectTypeOf(ctx.cookie).toBeUndefined()
				},
				transform: ({ query, cookie }) => {
					expectTypeOf(query.tags).toEqualTypeOf<
						string[] | undefined
					>()
					expectTypeOf(query.either).toEqualTypeOf<
						string[] | undefined
					>()
					expectTypeOf(query.o).toBeUnknown()
					expectTypeOf(query.n).toEqualTypeOf<string | undefined>()
					expectTypeOf(cookie).toBeUndefined()
				}
			},
			({ query }) => query.tags
		)
}
