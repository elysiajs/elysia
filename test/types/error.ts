/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, NotFound, status, problem } from '../../src'

import { expectTypeOf } from 'expect-type'

// Returned errors resolve through the closest registered class handler.

class MyError extends Error {
	readonly kind = 'my-error'

	constructor(message: string) {
		super(message)
	}
}

class ChildError extends MyError {
	readonly child = true
}

class OtherError extends Error {
	readonly kind = 'other-error'

	constructor(message: string) {
		super(message)
	}
}

// Handler context narrows `error` to the registered class.
{
	new Elysia().error(MyError, ({ error }) => {
		expectTypeOf(error).toEqualTypeOf<MyError>()
	})
}

// A returned error maps to its registered handler response.
{
	const app = new Elysia()
		.error(MyError, ({ error }) => status(404, { message: error.message }))
		.get('/', () => new MyError('Hello Error'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()
}

// Successful and handled-error responses remain distinct.
{
	const app = new Elysia()
		.error(MyError, ({ error }) => status(404, { message: error.message }))
		.get('/', () =>
			Math.random() > 0.5 ? ('ok' as const) : new MyError('x')
		)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		404: { readonly message: string }
	}>()
}

// Each returned error maps to its registered handler response.
{
	class FirstError extends Error {
		readonly kind = 'first'
	}
	class SecondError extends Error {
		readonly kind = 'second'
	}

	const app = new Elysia()
		.error(FirstError, () => problem(400, { detail: 'first' }))
		.error(SecondError, () => problem(401, { detail: 'second' }))
		.get('/', () => {
			if (Math.random() > 0.5) return new FirstError()
			if (Math.random() > 0.5) return new SecondError()

			return 'ok'
		})

	expectTypeOf<
		keyof (typeof app)['~Routes']['get']['response']
	>().toEqualTypeOf<200 | 400 | 401>()

	const firstOnly = new Elysia()
		.error(FirstError, () => problem(400, { detail: 'first' }))
		.error(SecondError, () => problem(401, { detail: 'second' }))
		.get('/', () =>
			Math.random() > 0.5 ? new FirstError() : ('ok' as const)
		)

	expectTypeOf<
		keyof (typeof firstOnly)['~Routes']['get']['response']
	>().toEqualTypeOf<200 | 400>()
}

// Unhandled returned errors become 500 responses and remain resolvable.
{
	const app = new Elysia().get('/', () => new OtherError('x'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		500: OtherError
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<OtherError>()
}

// Resolving one returned error keeps the remaining error at 500.
{
	const app = new Elysia()
		.get('/', () =>
			Math.random() > 0.5 ? new MyError('x') : new OtherError('x')
		)
		.error(MyError, ({ error }) => status(404, { message: error.message }))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
		500: OtherError
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<OtherError>()
}

// Plain handler returns use the error's status, or 500 by default.
{
	const app = new Elysia()
		.error(MyError, ({ error }) => error.message)
		.get('/', () => new MyError('x'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		500: string
	}>()
}
{
	const app = new Elysia()
		.error(NotFound, ({ error }) => error.message)
		.get('/', () => new NotFound())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: string
	}>()
}

// The first matching class handler determines the response.
{
	const app = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.error(ChildError, () => status(403, 'child' as const))
		.get('/', () => new ChildError('x'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'parent'
	}>()
}

// Local error handlers apply only to routes on the same instance.
{
	const plugin = new Elysia()
		.error(MyError, ({ error }) => status(404, { message: error.message }))
		.get('/inner', () => new MyError('x'))

	const app = new Elysia().use(plugin).get('/outer', () => new MyError('x'))

	expectTypeOf<
		(typeof plugin)['~Routes']['inner']['get']['response']
	>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()

	expectTypeOf<
		(typeof app)['~Routes']['outer']['get']['response']
	>().toEqualTypeOf<{ 500: MyError }>()
	expectTypeOf<
		(typeof app)['~Routes']['outer']['get']['error']
	>().toEqualTypeOf<MyError>()
}

// Plugin-scoped handlers apply to the immediate consumer only.
{
	const plugin = new Elysia().error('plugin', MyError, ({ error }) =>
		status(404, { message: error.message })
	)

	const parent = new Elysia().use(plugin).get('/', () => new MyError('x'))

	expectTypeOf<
		(typeof parent)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()

	const grandparent = new Elysia()
		.use(new Elysia().use(plugin))
		.get('/', () => new MyError('x'))

	expectTypeOf<
		(typeof grandparent)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 500: MyError }>()
	expectTypeOf<
		(typeof grandparent)['~Routes']['get']['error']
	>().toEqualTypeOf<MyError>()
}

// Global handlers apply at every nesting depth.
{
	const plugin = new Elysia().error('global', MyError, ({ error }) =>
		status(404, { message: error.message })
	)

	const app = new Elysia()
		.use(new Elysia().use(plugin))
		.get('/', () => new MyError('x'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()
}

// Catch-all `.error(fn)` handlers do not add route response types.
{
	const app = new Elysia()
		.error(({ error }) => {
			expectTypeOf(error).toEqualTypeOf<Error>()
		})
		.get('/', () => 'hi' as const)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'hi'
	}>()
}

// Parent handlers apply to routes from composed plugins.
{
	const routes = new Elysia().get('/', () => new MyError('x'))

	const app = new Elysia()
		.error(MyError, ({ error }) => status(404, { message: error.message }))
		.use(routes)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()
}

// Error handlers map routes even when registered after the route or plugin.
{
	const sameInstance = new Elysia()
		.get('/', () => new MyError('x'))
		.error(MyError, ({ error }) => status(404, { message: error.message }))

	expectTypeOf<
		(typeof sameInstance)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()

	const afterUse = new Elysia()
		.use(new Elysia().get('/', () => new MyError('x')))
		.error(MyError, ({ error }) => status(404, { message: error.message }))

	expectTypeOf<
		(typeof afterUse)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()
}

// A plugin's own handler takes precedence over its parent's.
{
	const routes = new Elysia()
		.error(MyError, () => status(403, 'plugin' as const))
		.get('/', () => new MyError('x'))

	const app = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'plugin'
	}>()
}

// Composition preserves returned errors until a matching handler is registered.
{
	const direct = new Elysia().get('/x', () =>
		Math.random() > 0.5 ? new MyError('x') : ('ok' as const)
	)

	expectTypeOf<
		(typeof direct)['~Routes']['x']['get']['error']
	>().toEqualTypeOf<MyError>()

	const used = new Elysia().use(direct)

	expectTypeOf<
		(typeof used)['~Routes']['x']['get']['error']
	>().toEqualTypeOf<MyError>()

	const grouped = new Elysia().group('/g', (app) =>
		app.get('/x', () =>
			Math.random() > 0.5 ? new MyError('x') : ('ok' as const)
		)
	)

	expectTypeOf<
		(typeof grouped)['~Routes']['g']['x']['get']['error']
	>().toEqualTypeOf<MyError>()

	const groupedWithHook = new Elysia().group('/h', {}, (app) =>
		app.get('/x', () =>
			Math.random() > 0.5 ? new MyError('x') : ('ok' as const)
		)
	)

	expectTypeOf<
		(typeof groupedWithHook)['~Routes']['h']['x']['get']['error']
	>().toEqualTypeOf<MyError>()

	const guarded = new Elysia().guard({}, (app) =>
		app.get('/x', () =>
			Math.random() > 0.5 ? new MyError('x') : ('ok' as const)
		)
	)

	expectTypeOf<
		(typeof guarded)['~Routes']['x']['get']['error']
	>().toEqualTypeOf<MyError>()

	// A parent handler removes the matched error and adds its response.
	const resolved = new Elysia()
		.use(used)
		.error(MyError, () => 'handled' as const)

	expectTypeOf<
		(typeof resolved)['~Routes']['x']['get']['error']
	>().toEqualTypeOf<never>()

	expectTypeOf<
		(typeof resolved)['~Routes']['x']['get']['response'][500]
	>().toEqualTypeOf<'handled'>()
}

// problem() infers its body under the selected numeric status.
{
	const app = new Elysia().get('/', () => problem({ status: 409 }))

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][409]
	>().toMatchTypeOf<{ type: string; title: string; status: 409 }>()
}

// A StatusMap name maps to its numeric response key.
{
	const app = new Elysia().get('/', () => problem({ status: 'Conflict' }))

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][409]
	>().toMatchTypeOf<{ status: 409 }>()
}

// Extension members remain in the inferred body.
{
	const app = new Elysia().get('/', () => problem({ status: 409, sku: 42 }))

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][409]
	>().toMatchTypeOf<{ sku: number }>()
}

// The status-first overload maps to the numeric response key.
{
	const app = new Elysia().get('/', () =>
		problem(409, { detail: 'literal detail', sku: 42 })
	)

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][409]
	>().toMatchTypeOf<{ status: 409; sku: number }>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][409]['detail']
	>().toEqualTypeOf<'literal detail'>()
}

// An annotated envelope member replaces the default one: it narrows to the
// literal supplied and stops being optional, while the members left alone
// keep the envelope's own declarations.
{
	const app = new Elysia().get('/', () =>
		problem(409, { title: 'Sold out' as const })
	)

	type Body = (typeof app)['~Routes']['get']['response'][409]

	expectTypeOf<Body['title']>().toEqualTypeOf<'Sold out'>()
	expectTypeOf<Body['type']>().toEqualTypeOf<string>()
	expectTypeOf<Body['detail']>().toEqualTypeOf<string | undefined>()
}

// `instance` narrows the same way.
{
	const app = new Elysia().get('/', () =>
		problem(409, { instance: '/order/1' as const })
	)

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][409]['instance']
	>().toEqualTypeOf<'/order/1'>()
}

{
	// The status-first overload rejects a second `status`: the positional one wins
	// at runtime, so accepting it in the detail would silently discard it.
	// @ts-expect-error
	problem(409, { status: 200 })
	// @ts-expect-error
	problem(409, { status: 'Conflict' })

	// an extension member that merely *contains* a status is untouched
	problem(409, { meta: { status: 'nested' } })
}
