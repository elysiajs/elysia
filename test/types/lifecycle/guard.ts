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

// ? a bare `.guard({ ... })` is OVERRIDE-channel: the closer to the route,
// ? the more power — a route-local `response` replaces the guard's per status
// ? code, so returning only `{ id }` is correct (mirrors the runtime
// ? "override guard when local is provided" behavior).
{
	new Elysia()
		.guard({ response: t.Object({ name: t.Literal('cantarella') }) })
		.post('/', () => ({ id: 1 }), {
			response: t.Object({ id: t.Number() })
		})
}

// ? without a route-local response, the override guard's response IS the
// ? route's contract
{
	new Elysia()
		.guard({ response: t.Object({ name: t.Literal('cantarella') }) })
		// @ts-expect-error must satisfy the guard's response
		.post('/', () => ({ id: 1 }))

	new Elysia()
		.guard({ response: t.Object({ name: t.Literal('cantarella') }) })
		.post('/', () => ({ name: 'cantarella' as const }))
}

// ? `schema: 'standalone'` opts into INTERSECT: every visible standalone
// ? validator runs, so the handler must satisfy BOTH `{ id }` (route) and
// ? `{ name: 'cantarella' }` (guard).
{
	new Elysia()
		.guard({
			schema: 'standalone',
			response: t.Object({ name: t.Literal('cantarella') })
		})
		// @ts-expect-error handler must also satisfy the standalone guard response
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

// ? guard().as('plugin') promotes the schema one level via .use
{
	const plugin = new Elysia()
		.guard({ body: t.Object({ name: t.String() }) })
		.as('plugin')

	new Elysia().use(plugin).post('/', ({ body }) => {
		expectTypeOf<typeof body>().toEqualTypeOf<{ name: string }>()
	})
}

export {}
