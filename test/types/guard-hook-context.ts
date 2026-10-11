import { Elysia } from '../../src'
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
