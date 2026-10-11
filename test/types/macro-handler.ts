import { Elysia, t } from '../../src'
import { expectTypeOf } from 'expect-type'

// macro `handler` wraps the route handler with the macro's typed context
{
	new Elysia()
		.decorate('db', 'sqlite' as const)
		.macro({
			tap: {
				handler: (handler) => (context) => {
					expectTypeOf(context.db).toEqualTypeOf<'sqlite'>()
					expectTypeOf(handler)
						.parameter(0)
						.toEqualTypeOf<typeof context>()
					expectTypeOf(handler(context)).toEqualTypeOf<unknown>()

					return handler(context)
				}
			}
		})
		.get('/', { tap: true }, () => 'ok')
}

// a guard schema reaches the wrapper
{
	new Elysia()
		.guard({ query: t.Object({ page: t.Number() }) })
		.macro({
			tap: {
				handler: (handler) => (context) => {
					expectTypeOf(context.query).toEqualTypeOf<{
						page: number
					}>()

					return handler(context)
				}
			}
		})
		.get('/', { tap: true }, () => 'ok')
}

// a non-function `handler` is rejected
{
	new Elysia().macro({
		// @ts-expect-error
		tap: {
			handler: 'not a wrapper'
		}
	})
}
