/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, NotFound, status, problem } from '../../src'

import { expectTypeOf } from 'expect-type'
import { ZodError } from 'zod'

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
		.error(MyError, ({ error }) => status(404, { message: error.message }))
		.get('/', () =>
			Math.random() > 0.5 ? new MyError('x') : new OtherError('x')
		)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
		500: OtherError
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<OtherError>()
}

// Data with a string `name` and `message` is a 200 value, not an error.
{
	const app = new Elysia().get('/', () => ({
		id: 1,
		name: 'Alice',
		message: 'hi'
	}))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: { id: number; name: string; message: string }
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()
}

// Classified per union member: the data stays 200, the real Error goes 500.
{
	const app = new Elysia().get('/', () =>
		Math.random() > 0.5
			? { id: 1, name: 'Alice', message: 'hi' }
			: new OtherError('x')
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: { id: number; name: string; message: string }
		500: OtherError
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<OtherError>()
}

// A registered class handler must not capture data shaped like an `Error`.
{
	const app = new Elysia()
		.error(MyError, ({ error }) => status(404, { message: error.message }))
		.get('/', () => ({ id: 1, name: 'Alice', message: 'hi' }))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: { id: number; name: string; message: string }
	}>()

	// even a handler for a class the data structurally satisfies
	class BareError extends Error {}

	const bare = new Elysia()
		.error(BareError, () => status(400, 'bare'))
		.get('/', () => ({ id: 1, name: 'Alice', message: 'hi' }))

	expectTypeOf<(typeof bare)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: { id: number; name: string; message: string }
	}>()
}

// `ZodError` declares `stack`, so it still routes to its registered handler.
{
	const app = new Elysia()
		.error(ZodError, () => status(418, 'quack'))
		.get('/', () => new ZodError([]))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'quack'
	}>()
}

// The reported repro, verbatim: the route's type always claimed 418, the
// runtime now agrees (it used to serve the ZodError as `200 []`)
{
	const errorHandler = new Elysia().error('global', ZodError, ({ error }) =>
		status(418, `quack! ${error.message}`)
	)

	const app = new Elysia().use(errorHandler).get('/', () => new ZodError([]))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: `quack! ${string}`
	}>()
}

// Same claim through the 2-arg class registration on an `as: 'global'` plugin
{
	const errorHandler = new Elysia({ as: 'global' }).error(
		ZodError,
		({ error }) => status(418, `quack! ${error.message}`)
	)

	const app = new Elysia().use(errorHandler).get('/', () => new ZodError([]))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: `quack! ${string}`
	}>()
}

// A class that is no `Error` still routes as one by declaring `stack`.
{
	class Problem {
		name = 'Problem'
		message = 'problem'
		stack?: string
	}

	const app = new Elysia()
		.error(Problem, () => status(418, 'problem'))
		.get('/', () => new Problem())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'problem'
	}>()
}

// Accepted trade-off: a class without `stack` is indistinguishable from data.
{
	class Bare {
		name = 'Bare'
		message = 'bare'
	}

	const app = new Elysia()
		.error(Bare, () => status(418, 'bare'))
		.get('/', () => new Bare())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: Bare
	}>()
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
			expectTypeOf(error).toEqualTypeOf<unknown>()
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

// An error handler reaches only the routes registered after it, as in 1.x.
// A late handler leaves an earlier route, its own or a plugin's, typed as it
// was: the error is still unhandled.
{
	const sameInstance = new Elysia()
		.get('/', () => new MyError('x'))
		.error(MyError, ({ error }) => status(404, { message: error.message }))

	expectTypeOf<
		(typeof sameInstance)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: MyError
	}>()
	expectTypeOf<
		(typeof sameInstance)['~Routes']['get']['error']
	>().toEqualTypeOf<MyError>()

	const afterUse = new Elysia()
		.use(new Elysia().get('/', () => new MyError('x')))
		.error(MyError, ({ error }) => status(404, { message: error.message }))

	expectTypeOf<
		(typeof afterUse)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: MyError
	}>()

	// A catch-all registered before the route doesn't change that
	const afterOwnHook = new Elysia()
		.error(() => {})
		.get('/', () => new MyError('x'))
		.error(MyError, ({ error }) => status(404, { message: error.message }))

	expectTypeOf<
		(typeof afterOwnHook)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: MyError
	}>()

	// Nor does a late catch-all add its response
	const lateCatchAll = new Elysia()
		.get('/', () => new MyError('x'))
		.error(() => status(418, 'late' as const))

	expectTypeOf<
		(typeof lateCatchAll)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: MyError
	}>()

	// Nor does a plugin used later that brings its own handler
	const handlerPlugin = new Elysia().error('global', MyError, () =>
		status(418, 'plugin' as const)
	)

	const lateUse = new Elysia()
		.get('/', () => new MyError('x'))
		.use(handlerPlugin)

	expectTypeOf<
		(typeof lateUse)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: MyError
	}>()

	const lateUseMany = new Elysia()
		.get('/', () => new MyError('x'))
		.use([handlerPlugin])

	expectTypeOf<
		(typeof lateUseMany)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: MyError
	}>()
}

// A class handler that may return nothing passes the error on to the next
// hook, as at runtime: it doesn't handle the error, so a later handler for the
// same class still answers
{
	const before = new Elysia()
		.error(MyError, () => {})
		.error(MyError, () => status(418, 'next' as const))
		.get('/', () => new MyError('x'))

	expectTypeOf<
		(typeof before)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		418: 'next'
	}>()
	expectTypeOf<
		(typeof before)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()

	// What it answers when it does answer stays
	const sometimes = new Elysia()
		.error(MyError, ({ error }) =>
			error.message ? status(409, 'own' as const) : undefined
		)
		.error(MyError, () => status(418, 'next' as const))
		.get('/', () => new MyError('x'))

	expectTypeOf<
		(typeof sometimes)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		409: 'own'
		418: 'next'
	}>()

	// With nothing after it, the error stays unhandled and is served as one
	const alone = new Elysia()
		.error(MyError, () => {})
		.get('/', () => new MyError('x'))

	expectTypeOf<(typeof alone)['~Routes']['get']['response']>().toEqualTypeOf<{
		500: MyError
	}>()
	expectTypeOf<
		(typeof alone)['~Routes']['get']['error']
	>().toEqualTypeOf<MyError>()
}

// A parent handler registered before `.use()` runs before the plugin's own at
// runtime (app-wide observers must see plugin-handled errors), so it takes
// over an error the plugin already handled. Registered after `.use()`, the
// plugin's own handler runs first and keeps it.
// Mirrored at runtime by test/lifecycle/nested-hook-order.test.ts
{
	const routes = new Elysia()
		.error(MyError, () => status(403, 'plugin' as const))
		.get('/', () => new MyError('x'))

	const before = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<
		(typeof before)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		418: 'parent'
	}>()
	expectTypeOf<
		(typeof before)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()

	const after = new Elysia()
		.use(routes)
		.error(MyError, () => status(418, 'parent' as const))

	expectTypeOf<(typeof after)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'plugin'
	}>()

	// A parent handler for another class leaves the plugin's handler alone
	const other = new Elysia()
		.error(OtherError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<(typeof other)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'plugin'
	}>()

	// A child-class parent handler doesn't match the base-class error
	const child = new Elysia()
		.error(ChildError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<(typeof child)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'plugin'
	}>()

	// A base-class parent handler does
	const base = new Elysia()
		.error(Error, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<(typeof base)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'parent'
	}>()

	// A catch-all `.error(fn)` runs first too, but may return nothing for an
	// error and fall through to the plugin's handler, so both can respond
	const catchAll = new Elysia()
		.error(() => status(418, 'catch-all' as const))
		.use(routes)

	expectTypeOf<
		(typeof catchAll)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		403: 'plugin'
		418: 'catch-all'
	}>()

	// Plugin handler registered after its route
	const late = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.use(
			new Elysia()
				.get('/', () => new MyError('x'))
				.error(MyError, () => status(403, 'plugin' as const))
		)

	expectTypeOf<(typeof late)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'parent'
	}>()

	// Global and plugin-scoped parent handlers take over too
	const global = new Elysia()
		.error('global', MyError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<
		(typeof global)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		418: 'parent'
	}>()

	const scoped = new Elysia()
		.error('plugin', MyError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<
		(typeof scoped)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		418: 'parent'
	}>()

	// Inside a group
	const grouped = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.group('/g', (app) => app.use(routes))

	expectTypeOf<
		(typeof grouped)['~Routes']['g']['get']['response']
	>().toEqualTypeOf<{
		418: 'parent'
	}>()
}

// Only the taken-over error moves; the plugin keeps the rest
{
	const routes = new Elysia()
		.error(MyError, () => status(403, 'same' as const))
		.error(OtherError, () => status(403, 'same' as const))
		.get('/', () =>
			Math.random() > 0.5 ? new MyError('x') : new OtherError('y')
		)

	const app = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'same'
		418: 'parent'
	}>()

	const mixed = new Elysia()
		.error(MyError, () => status(403, 'plugin' as const))
		.get('/', () =>
			Math.random() > 0.5
				? new MyError('x')
				: Math.random() > 0.5
					? new OtherError('y')
					: ('ok' as const)
		)

	const app2 = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.error(OtherError, () => status(409, 'other' as const))
		.use(mixed)

	expectTypeOf<(typeof app2)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		409: 'other'
		418: 'parent'
	}>()
	expectTypeOf<
		(typeof app2)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()
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
		.error(MyError, () => 'handled' as const)
		.use(used)

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
