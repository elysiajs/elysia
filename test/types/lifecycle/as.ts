import { Elysia, status } from '../../../src'
import { expectTypeOf } from 'expect-type'

class MyError extends Error {
	readonly kind = 'my-error'
}

// ? as('scoped') promotes a local resolve to propagate one level via .use
{
	const plugin = new Elysia()
		.derive(() => ({ token: 'abc' as const }))
		.as('plugin')

	new Elysia().use(plugin).get('/', ({ token }) => {
		expectTypeOf<typeof token>().toEqualTypeOf<'abc'>()
	})
}

// ? as('global') promotes a local resolve to propagate everywhere
{
	const plugin = new Elysia()
		.derive(() => ({ token: 'abc' as const }))
		.as('global')

	const app = new Elysia().use(plugin)

	new Elysia().use(app).get('/', ({ token }) => {
		expectTypeOf<typeof token>().toEqualTypeOf<'abc'>()
	})
}

// ? as('scoped') is one hop only — a scoped resolve does not leak two levels
{
	const plugin = new Elysia()
		.derive(() => ({ token: 'abc' as const }))
		.as('plugin')

	const mid = new Elysia().use(plugin)

	new Elysia().use(mid).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('token')
	})
}

// ? as('global') promotes a local .error() handler to map at any depth —
// ? equivalent to registering it with `.error('global', MyError, …)`. This
// ? exercises the error-channel promotion (Volatile/Ephemeral → Definitions).
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

export {}
