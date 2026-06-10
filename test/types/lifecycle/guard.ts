import { Elysia, t } from '../../../src'
import { expectTypeOf } from 'expect-type'

// ? guard(hook) accumulates a standalone schema into subsequent route context
{
	new Elysia()
		.guard({ body: t.Object({ name: t.String() }) })
		.post('/', ({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<{ name: string }>()
		})
}

// ? guard(hook) accumulates a query schema into subsequent route context
{
	new Elysia()
		.guard({ query: t.Object({ page: t.Number() }) })
		.get('/', ({ query }) => {
			expectTypeOf<typeof query>().toEqualTypeOf<{ page: number }>()
		})
}

// ? a guard `response` schema is enforced at runtime only — it must NOT
// ? over-constrain a route's own local response (regression guard: standalone
// ? response stays overridable, otherwise the handler would be forced to also
// ? satisfy the guard response and this block would fail to compile).
{
	new Elysia()
		.guard({ response: t.Object({ name: t.Literal('cantarella') }) })
		.post('/', () => ({ id: 1 }), {
			response: t.Object({ id: t.Number() })
		})
}

// ? guard(hook, run) sandboxed builder sees the schema; routes merge back
{
	new Elysia().guard(
		{ body: t.Object({ name: t.String() }) },
		(app) =>
			app.post('/', ({ body }) => {
				expectTypeOf<typeof body>().toEqualTypeOf<{ name: string }>()
				return body
			})
	)
}

// ? a local guard schema does NOT leak to a parent via .use
{
	const plugin = new Elysia().guard({
		body: t.Object({ name: t.String() })
	})

	new Elysia().use(plugin).post('/', ({ body }) => {
		expectTypeOf<typeof body>().toEqualTypeOf<unknown>()
	})
}

// ? guard().as('scoped') promotes the schema one level via .use
{
	const plugin = new Elysia()
		.guard({ body: t.Object({ name: t.String() }) })
		.as('scoped')

	new Elysia().use(plugin).post('/', ({ body }) => {
		expectTypeOf<typeof body>().toEqualTypeOf<{ name: string }>()
	})
}

export {}
