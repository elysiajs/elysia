import { Elysia, t } from '../../../src'
import { expectTypeOf } from 'expect-type'

// Guard body schemas type subsequent routes.
{
	new Elysia()
		.guard({ body: t.Object({ name: t.String() }) })
		.post('/', ({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<{ name: string }>()
		})
}

// Guard query schemas type subsequent routes.
{
	new Elysia()
		.guard({ query: t.Object({ page: t.Number() }) })
		.get('/', ({ query }) => {
			expectTypeOf<typeof query>().toEqualTypeOf<{ page: number }>()
		})
}

// A route response schema replaces an ordinary guard response schema.
{
	new Elysia()
		.guard({ response: t.Object({ name: t.Literal('cantarella') }) })
		.post(
			'/',
			{
				response: t.Object({ id: t.Number() })
			},
			() => ({ id: 1 })
		)
}

// Without a route response schema, the guard constrains the handler return.
{
	new Elysia()
		.guard({ response: t.Object({ name: t.Literal('cantarella') }) })
		// @ts-expect-error must satisfy the guard's response
		.post('/', () => ({ id: 1 }))

	new Elysia()
		.guard({ response: t.Object({ name: t.Literal('cantarella') }) })
		.post('/', () => ({ name: 'cantarella' as const }))
}

// Standalone guard and route response schemas both constrain the handler.
{
	new Elysia()
		.guard({
			schema: 'standalone',
			response: t.Object({ name: t.Literal('cantarella') })
		})
		.post(
			'/',
			{
				response: t.Object({ id: t.Number() })
			},
			// @ts-expect-error handler must also satisfy the standalone guard response
			() => ({ id: 1 })
		)
}

// Guard callback routes receive the guard schema.
{
	new Elysia().guard({ body: t.Object({ name: t.String() }) }, (app) =>
		app.post('/', ({ body }) => {
			expectTypeOf<typeof body>().toEqualTypeOf<{ name: string }>()
			return body
		})
	)
}

// Local guard schemas do not affect plugin consumers.
{
	const plugin = new Elysia().guard({
		body: t.Object({ name: t.String() })
	})

	new Elysia().use(plugin).post('/', ({ body }) => {
		expectTypeOf<typeof body>().toEqualTypeOf<unknown>()
	})
}

// `.as('plugin')` exposes a guard schema to one consumer.
{
	const plugin = new Elysia()
		.guard({ body: t.Object({ name: t.String() }) })
		.as('plugin')

	new Elysia().use(plugin).post('/', ({ body }) => {
		expectTypeOf<typeof body>().toEqualTypeOf<{ name: string }>()
	})
}

export {}

// The nearest declared params schema defines the complete params type.
{
	// Route params replace guard params.
	new Elysia().guard({ params: t.Object({ id: t.Number() }) }, (app) =>
		app.get(
			'/guard/:id/:name',
			{
				params: t.Object({ name: t.String() })
			},
			({ params }) => {
				expectTypeOf(params).toEqualTypeOf<{ name: string }>()
			}
		)
	)

	// Routes without params schemas inherit guard params.
	new Elysia().guard({ params: t.Object({ id: t.Number() }) }, (app) =>
		app.get('/guard/:id/:name', ({ params }) => {
			expectTypeOf(params).toEqualTypeOf<{ id: number }>()
		})
	)

	// The nearest nested guard params schema wins.
	new Elysia().guard({ params: t.Object({ id: t.Number() }) }, (app) =>
		app.guard({ params: t.Object({ name: t.Literal('x') }) }, (app) =>
			app.get('/guard/:id/:name', ({ params }) => {
				expectTypeOf(params).toEqualTypeOf<{ name: 'x' }>()
			})
		)
	)

	// Without a params schema, path params remain strings.
	new Elysia().guard({}, (app) =>
		app.get('/guard/:id/:name', ({ params }) => {
			expectTypeOf(params).toEqualTypeOf<{ id: string; name: string }>()
		})
	)
}
