import { Elysia, status, t } from '../../../src'
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

// ? as('global') promotes a guard's RESPONSE constraint so a wrong-return
// ? handler is a TYPE error at ANY depth (negative-direction pins — these were
// ? the @ts-expect-error tripwires in test/core/as.test.ts that the type gate
// ? stopped covering once it narrowed off the runtime suite).
{
	const inner = new Elysia()
		.guard({ response: t.Number() })
		// @ts-expect-error handler must satisfy the guarded response: t.Number()
		.get('/inner', () => 'a')
		.as('global')

	const plugin = new Elysia()
		.use(inner)
		// @ts-expect-error globally-promoted response: t.Number() rejects boolean
		.get('/plugin', () => true)

	new Elysia()
		.use(plugin)
		// @ts-expect-error promoted globally — still rejects a string two levels up
		.get('/', () => 'not a number')
}

// ? as('plugin') promotes the response constraint ONE hop only: it rejects a
// ? wrong return in the immediate parent, but does NOT reach the grandparent.
{
	const inner = new Elysia()
		.guard({ response: t.Number() })
		// @ts-expect-error handler must satisfy the guarded response: t.Number()
		.get('/inner', () => 'a')
		.as('plugin')

	const plugin = new Elysia()
		.use(inner)
		// @ts-expect-error one-hop-promoted response rejects boolean in the parent
		.get('/plugin', () => true)

	// two levels up the plugin-scoped response no longer applies, so a
	// non-number return is allowed (NO @ts-expect-error here is the assertion).
	new Elysia().use(plugin).get('/', () => 'not a number')
}

export {}
