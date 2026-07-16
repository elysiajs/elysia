import { Elysia } from '../../src'
import { expectTypeOf } from 'expect-type'

// guard/group hook handlers (beforeHandle/afterHandle/error) run
// AFTER derive and macro resolution at runtime — their typed context must
// include instance-derive values and macro-derived (resolve-channel) values,
// which flow through `MacroContext['resolve']`, not `['response']`.
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
				// error hooks can fire BEFORE derive runs (parse/validation
				// errors) — ErrorContext deliberately omits derive values
				expectTypeOf(ctx).not.toHaveProperty('traceId')
			}
		})
}

// group() hook handlers get the same context
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
