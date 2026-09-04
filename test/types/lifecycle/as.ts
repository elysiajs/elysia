import { Elysia, status, t } from '../../../src'
import { expectTypeOf } from 'expect-type'

class MyError extends Error {
	readonly kind = 'my-error'
}

// `.as('plugin')` exposes derived values to the immediate consumer.
{
	const plugin = new Elysia()
		.derive(() => ({ token: 'abc' as const }))
		.as('plugin')

	new Elysia().use(plugin).get('/', ({ token }) => {
		expectTypeOf<typeof token>().toEqualTypeOf<'abc'>()
	})
}

// `.as('global')` exposes derived values through nested consumers.
{
	const plugin = new Elysia()
		.derive(() => ({ token: 'abc' as const }))
		.as('global')

	const app = new Elysia().use(plugin)

	new Elysia().use(app).get('/', ({ token }) => {
		expectTypeOf<typeof token>().toEqualTypeOf<'abc'>()
	})
}

// `.as('plugin')` stops exposing derived values after one consumer.
{
	const plugin = new Elysia()
		.derive(() => ({ token: 'abc' as const }))
		.as('plugin')

	const mid = new Elysia().use(plugin)

	new Elysia().use(mid).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('token')
	})
}

// `.as('global')` exposes error handlers at every nesting depth.
{
	const plugin = new Elysia()
		.error(MyError, ({ error }) => status(404, { message: error.message }))
		.as('global')

	const app = new Elysia()
		.use(new Elysia().use(plugin))
		.get('/', () => new MyError('x'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()
}

// `.as('global')` applies guard response constraints at every nesting depth.
{
	const inner = new Elysia()
		.guard({ response: t.Number() })
		// @ts-expect-error guarded routes must return numbers
		.get('/inner', () => 'a')
		.as('global')

	const plugin = new Elysia()
		.use(inner)
		// @ts-expect-error the global response constraint rejects booleans
		.get('/plugin', () => true)

	new Elysia()
		.use(plugin)
		// @ts-expect-error the global response constraint reaches nested consumers
		.get('/', () => 'not a number')
}

// `.as('plugin')` applies response constraints to the immediate consumer only.
{
	const inner = new Elysia()
		.guard({ response: t.Number() })
		// @ts-expect-error guarded routes must return numbers
		.get('/inner', () => 'a')
		.as('plugin')

	const plugin = new Elysia()
		.use(inner)
		// @ts-expect-error the plugin response constraint rejects booleans
		.get('/plugin', () => true)

	// The plugin response constraint stops before the grandparent.
	new Elysia().use(plugin).get('/', () => 'not a number')
}

export {}
