/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, HTTPError, NotFound, status, problem, t } from '../../src'
import type { ValidationErrorResponse } from '../../src/error'
import { websocket } from '../../src/plugin/websocket'

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

// What an error that never described itself is served as: the generic
// internal-server-error problem document, not the error instance
type Unhandled500 = {
	type: string
	code: 'internal-server-error'
	title: 'Internal Server Error'
	status: 500
	detail?: string
	name?: string
	cause?: unknown
}

// Handler context narrows `error` to the registered class.
{
	new Elysia().onError(MyError, ({ error }) => {
		expectTypeOf(error).toEqualTypeOf<MyError>()
	})
}

// A returned error maps to its registered handler response.
{
	const app = new Elysia()
		.onError(MyError, ({ error }) =>
			status(404, { message: error.message })
		)
		.get('/', () => new MyError('Hello Error'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()
}

// Successful and handled-error responses remain distinct.
{
	const app = new Elysia()
		.onError(MyError, ({ error }) =>
			status(404, { message: error.message })
		)
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
		.onError(FirstError, () => problem(400, { detail: 'first' }))
		.onError(SecondError, () => problem(401, { detail: 'second' }))
		.get('/', () => {
			if (Math.random() > 0.5) return new FirstError()
			if (Math.random() > 0.5) return new SecondError()

			return 'ok'
		})

	expectTypeOf<
		keyof (typeof app)['~Routes']['get']['response']
	>().toEqualTypeOf<200 | 400 | 401>()

	const firstOnly = new Elysia()
		.onError(FirstError, () => problem(400, { detail: 'first' }))
		.onError(SecondError, () => problem(401, { detail: 'second' }))
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
		500: Unhandled500
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<OtherError>()
}

// Resolving one returned error keeps the remaining error at 500.
{
	const app = new Elysia()
		.onError(MyError, ({ error }) =>
			status(404, { message: error.message })
		)
		.get('/', () =>
			Math.random() > 0.5 ? new MyError('x') : new OtherError('x')
		)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
		500: Unhandled500
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
		500: Unhandled500
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<OtherError>()
}

// A registered class handler must not capture data shaped like an `Error`.
{
	const app = new Elysia()
		.onError(MyError, ({ error }) =>
			status(404, { message: error.message })
		)
		.get('/', () => ({ id: 1, name: 'Alice', message: 'hi' }))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: { id: number; name: string; message: string }
	}>()

	// even a handler for a class the data structurally satisfies
	class BareError extends Error {}

	const bare = new Elysia()
		.onError(BareError, () => status(400, 'bare'))
		.get('/', () => ({ id: 1, name: 'Alice', message: 'hi' }))

	expectTypeOf<(typeof bare)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: { id: number; name: string; message: string }
	}>()
}

// `ZodError` declares `stack`, so it still routes to its registered handler.
{
	const app = new Elysia()
		.onError(ZodError, () => status(418, 'quack'))
		.get('/', () => new ZodError([]))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'quack'
	}>()
}

// The reported repro, verbatim: the route's type always claimed 418, the
// runtime now agrees (it used to serve the ZodError as `200 []`)
{
	const errorHandler = new Elysia().onError('global', ZodError, ({ error }) =>
		status(418, `quack! ${error.message}`)
	)

	const app = new Elysia().use(errorHandler).get('/', () => new ZodError([]))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: `quack! ${string}`
	}>()
}

// Same claim through the 2-arg class registration on an `as: 'global'` plugin
{
	const errorHandler = new Elysia({ as: 'global' }).onError(
		ZodError,
		({ error }) => status(418, `quack! ${error.message}`)
	)

	const app = new Elysia().use(errorHandler).get('/', () => new ZodError([]))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: `quack! ${string}`
	}>()
}

// A class that is no `Error` still routes as one by declaring `stack`. It
// adds nothing to `Error`, so its handler may be the one that answers
{
	class Problem {
		name = 'Problem'
		message = 'problem'
		stack?: string
	}

	const app = new Elysia()
		.onError(Problem, () => status(418, 'problem'))
		.get('/', () => new Problem())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'problem'
		500: Unhandled500
	}>()
}

// Accepted trade-off: a class without `stack` is indistinguishable from data.
{
	class Bare {
		name = 'Bare'
		message = 'bare'
	}

	const app = new Elysia()
		.onError(Bare, () => status(418, 'bare'))
		.get('/', () => new Bare())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: Bare
	}>()
}

// Plain handler returns use the error's status, or 500 by default.
{
	const app = new Elysia()
		.onError(MyError, ({ error }) => error.message)
		.get('/', () => new MyError('x'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		500: string
	}>()
}
{
	const app = new Elysia()
		.onError(NotFound, ({ error }) => error.message)
		.get('/', () => new NotFound())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: string
	}>()
}

// The first matching class handler determines the response.
{
	const app = new Elysia()
		.onError(MyError, () => status(418, 'parent' as const))
		.onError(ChildError, () => status(403, 'child' as const))
		.get('/', () => new ChildError('x'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'parent'
	}>()
}

// Local error handlers apply only to routes on the same instance.
{
	const plugin = new Elysia()
		.onError(MyError, ({ error }) =>
			status(404, { message: error.message })
		)
		.get('/inner', () => new MyError('x'))

	const app = new Elysia().use(plugin).get('/outer', () => new MyError('x'))

	expectTypeOf<
		(typeof plugin)['~Routes']['inner']['get']['response']
	>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()

	expectTypeOf<
		(typeof app)['~Routes']['outer']['get']['response']
	>().toEqualTypeOf<{ 500: Unhandled500 }>()
	expectTypeOf<
		(typeof app)['~Routes']['outer']['get']['error']
	>().toEqualTypeOf<MyError>()
}

// Plugin-scoped handlers apply to the immediate consumer only.
{
	const plugin = new Elysia().onError('plugin', MyError, ({ error }) =>
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
	>().toEqualTypeOf<{ 500: Unhandled500 }>()
	expectTypeOf<
		(typeof grandparent)['~Routes']['get']['error']
	>().toEqualTypeOf<MyError>()
}

// Global handlers apply at every nesting depth.
{
	const plugin = new Elysia().onError('global', MyError, ({ error }) =>
		status(404, { message: error.message })
	)

	const app = new Elysia()
		.use(new Elysia().use(plugin))
		.get('/', () => new MyError('x'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()
}

// Catch-all `.onError(fn)` handlers do not add route response types.
{
	const app = new Elysia()
		.onError(({ error }) => {
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
		.onError(MyError, ({ error }) =>
			status(404, { message: error.message })
		)
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
		.onError(MyError, ({ error }) =>
			status(404, { message: error.message })
		)

	expectTypeOf<
		(typeof sameInstance)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: Unhandled500
	}>()
	expectTypeOf<
		(typeof sameInstance)['~Routes']['get']['error']
	>().toEqualTypeOf<MyError>()

	const afterUse = new Elysia()
		.use(new Elysia().get('/', () => new MyError('x')))
		.onError(MyError, ({ error }) =>
			status(404, { message: error.message })
		)

	expectTypeOf<
		(typeof afterUse)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: Unhandled500
	}>()

	// A catch-all registered before the route doesn't change that
	const afterOwnHook = new Elysia()
		.onError(() => {})
		.get('/', () => new MyError('x'))
		.onError(MyError, ({ error }) =>
			status(404, { message: error.message })
		)

	expectTypeOf<
		(typeof afterOwnHook)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: Unhandled500
	}>()

	// Nor does a late catch-all add its response
	const lateCatchAll = new Elysia()
		.get('/', () => new MyError('x'))
		.onError(() => status(418, 'late' as const))

	expectTypeOf<
		(typeof lateCatchAll)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: Unhandled500
	}>()

	// Nor does a plugin used later that brings its own handler
	const handlerPlugin = new Elysia().onError('global', MyError, () =>
		status(418, 'plugin' as const)
	)

	const lateUse = new Elysia()
		.get('/', () => new MyError('x'))
		.use(handlerPlugin)

	expectTypeOf<
		(typeof lateUse)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: Unhandled500
	}>()

	const lateUseMany = new Elysia()
		.get('/', () => new MyError('x'))
		.use([handlerPlugin])

	expectTypeOf<
		(typeof lateUseMany)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		500: Unhandled500
	}>()
}

// A class handler that may return nothing passes the error on to the next
// hook, as at runtime: it doesn't handle the error, so a later handler for the
// same class still answers
{
	const before = new Elysia()
		.onError(MyError, () => {})
		.onError(MyError, () => status(418, 'next' as const))
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
		.onError(MyError, ({ error }) =>
			error.message ? status(409, 'own' as const) : undefined
		)
		.onError(MyError, () => status(418, 'next' as const))
		.get('/', () => new MyError('x'))

	expectTypeOf<
		(typeof sometimes)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		409: 'own'
		418: 'next'
	}>()

	// With nothing after it, the error stays unhandled and is served as one
	const alone = new Elysia()
		.onError(MyError, () => {})
		.get('/', () => new MyError('x'))

	expectTypeOf<(typeof alone)['~Routes']['get']['response']>().toEqualTypeOf<{
		500: Unhandled500
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
		.onError(MyError, () => status(403, 'plugin' as const))
		.get('/', () => new MyError('x'))

	const before = new Elysia()
		.onError(MyError, () => status(418, 'parent' as const))
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
		.onError(MyError, () => status(418, 'parent' as const))

	expectTypeOf<(typeof after)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'plugin'
	}>()

	// A parent handler for another class leaves the plugin's handler alone
	const other = new Elysia()
		.onError(OtherError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<(typeof other)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'plugin'
	}>()

	// A child-class parent handler doesn't match the base-class error
	const child = new Elysia()
		.onError(ChildError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<(typeof child)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'plugin'
	}>()

	// A base-class parent handler does
	const base = new Elysia()
		.onError(Error, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<(typeof base)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'parent'
	}>()

	// A catch-all `.onError(fn)` runs first too. One that always answers takes
	// the error over
	const catchAll = new Elysia()
		.onError(() => status(418, 'catch-all' as const))
		.use(routes)

	expectTypeOf<
		(typeof catchAll)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		418: 'catch-all'
	}>()

	// One that may return nothing falls through to the plugin's handler, so
	// both can respond
	const passes = new Elysia()
		.onError(({ error }) =>
			error instanceof OtherError
				? status(418, 'catch-all' as const)
				: undefined
		)
		.use(routes)

	expectTypeOf<
		(typeof passes)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		403: 'plugin'
		418: 'catch-all'
	}>()

	// Plugin handler registered after its route
	const late = new Elysia()
		.onError(MyError, () => status(418, 'parent' as const))
		.use(
			new Elysia()
				.get('/', () => new MyError('x'))
				.onError(MyError, () => status(403, 'plugin' as const))
		)

	expectTypeOf<(typeof late)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'parent'
	}>()

	// Global and plugin-scoped parent handlers take over too
	const global = new Elysia()
		.onError('global', MyError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<
		(typeof global)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		418: 'parent'
	}>()

	const scoped = new Elysia()
		.onError('plugin', MyError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<
		(typeof scoped)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		418: 'parent'
	}>()

	// Inside a group
	const grouped = new Elysia()
		.onError(MyError, () => status(418, 'parent' as const))
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
		.onError(MyError, () => status(403, 'same' as const))
		.onError(OtherError, () => status(403, 'same' as const))
		.get('/', () =>
			Math.random() > 0.5 ? new MyError('x') : new OtherError('y')
		)

	const app = new Elysia()
		.onError(MyError, () => status(418, 'parent' as const))
		.use(routes)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'same'
		418: 'parent'
	}>()

	const mixed = new Elysia()
		.onError(MyError, () => status(403, 'plugin' as const))
		.get('/', () =>
			Math.random() > 0.5
				? new MyError('x')
				: Math.random() > 0.5
					? new OtherError('y')
					: ('ok' as const)
		)

	const app2 = new Elysia()
		.onError(MyError, () => status(418, 'parent' as const))
		.onError(OtherError, () => status(409, 'other' as const))
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
		.onError(MyError, () => 'handled' as const)
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

// Matching is structural, the runtime matches by constructor. A class that
// adds nothing to `Error` matches every error structurally, but only its own
// instances reach its handler, which the types can't tell apart: it may
// answer, and the error may still go unhandled. Served at runtime by
// test/lifecycle/error-class-match.test.ts
{
	class EmptyA extends Error {}
	class EmptyB extends Error {}
	class RateLimited extends HTTPError.id('RATE_LIMITED', 429) {}

	const twin = new Elysia()
		.onError(EmptyA, () => status(418, 'teapot' as const))
		.get('/', (): EmptyB | 'ok' =>
			Math.random() > 0.5 ? new EmptyB() : 'ok'
		)

	expectTypeOf<(typeof twin)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		418: 'teapot'
		500: Unhandled500
	}>()
	expectTypeOf<
		(typeof twin)['~Routes']['get']['error']
	>().toEqualTypeOf<EmptyB>()

	// an unrelated error keeps its own status
	const unrelated = new Elysia()
		.onError(EmptyA, () => status(401, 'no' as const))
		.get('/', () => new RateLimited())

	type Unrelated = (typeof unrelated)['~Routes']['get']['response']

	expectTypeOf<keyof Unrelated>().toEqualTypeOf<401 | 429>()
	expectTypeOf<Unrelated[429]['code']>().toEqualTypeOf<'RATE_LIMITED'>()

	// so does its own instance, as far as the types can tell
	const own = new Elysia()
		.onError(EmptyA, () => status(401, 'no' as const))
		.get('/', () => new EmptyA())

	expectTypeOf<(typeof own)['~Routes']['get']['response']>().toEqualTypeOf<{
		401: 'no'
		500: Unhandled500
	}>()

	// A built-in subclass such as `TypeError` adds nothing either. `Error`
	// itself does catch every error
	const typeError = new Elysia()
		.onError(TypeError, () => status(400, 'type' as const))
		.get('/', () => new RateLimited())
	const error = new Elysia()
		.onError(Error, () => status(418, 'any' as const))
		.get('/', () => new RateLimited())

	expectTypeOf<
		keyof (typeof typeError)['~Routes']['get']['response']
	>().toEqualTypeOf<400 | 429>()
	expectTypeOf<(typeof error)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'any'
	}>()
	expectTypeOf<
		(typeof error)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()

	// A member of its own, such as a literal `name`, tells a class apart
	class Named extends Error {
		name = 'Named' as const
	}

	class OtherNamed extends Error {
		name = 'OtherNamed' as const
	}

	const named = new Elysia()
		.onError(Named, () => status(418, 'named' as const))
		.get('/named', () => new Named('x'))
		.get('/other', () => new OtherNamed('x'))

	type Routes = (typeof named)['~Routes']

	expectTypeOf<Routes['named']['get']['response']>().toEqualTypeOf<{
		418: 'named'
	}>()
	expectTypeOf<Routes['other']['get']['response']>().toEqualTypeOf<{
		500: Unhandled500
	}>()
}

// An error with its own `status`, or a `toResponse()` handing back a
// `Response`, serves something only it knows, so it keeps its instance
// rather than the generic problem document. The runtime reads the value: an
// optional member may be absent, which serves the document, and so does a
// `toResponse` that isn't a function or hands back anything else
{
	class NotAResponse extends Error {
		toResponse() {
			return 'not a Response'
		}
	}

	class MaybeAResponse extends Error {
		toResponse() {
			return Math.random() > 0.5 ? new Response('custom') : 'no'
		}
	}

	class Answers extends Error {
		toResponse() {
			return new Response('custom', { status: 418 })
		}
	}

	class MayAnswer extends Error {
		toResponse?: () => Response = () =>
			new Response('custom', { status: 418 })
	}

	class NotCallable extends Error {
		readonly toResponse = 'nope'
	}

	class Wide extends Error {
		status: number = 503
	}

	class MayStatus extends Error {
		status?: number = 503
	}

	const app = new Elysia()
		.get('/answers', () => new Answers())
		.get('/may-answer', () => new MayAnswer())
		.get('/not-callable', () => new NotCallable())
		.get('/wide', () => new Wide())
		.get('/may-status', () => new MayStatus())
		.get('/not-a-response', () => new NotAResponse())
		.get('/maybe-a-response', () => new MaybeAResponse())

	type Routes = (typeof app)['~Routes']

	expectTypeOf<
		Routes['answers']['get']['response'][500]
	>().toEqualTypeOf<Answers>()
	expectTypeOf<Routes['may-answer']['get']['response'][500]>().toEqualTypeOf<
		MayAnswer | Unhandled500
	>()
	expectTypeOf<
		Routes['not-callable']['get']['response'][500]
	>().toEqualTypeOf<Unhandled500>()
	expectTypeOf<Routes['wide']['get']['response'][500]>().toEqualTypeOf<Wide>()
	expectTypeOf<Routes['may-status']['get']['response'][500]>().toEqualTypeOf<
		MayStatus | Unhandled500
	>()
	expectTypeOf<
		Routes['not-a-response']['get']['response'][500]
	>().toEqualTypeOf<Unhandled500>()
	expectTypeOf<
		Routes['maybe-a-response']['get']['response'][500]
	>().toEqualTypeOf<MaybeAResponse | Unhandled500>()
}

// Every unhandled plain error serves the same body, so a parent taking one
// over must not take a 500 the route serves for another reason: its own
// `status(500, …)`, whatever the shape, or another unhandled error
{
	class Taken extends Error {
		readonly taken = true
	}

	class Later extends Error {
		readonly later = true
	}

	const own = {
		type: 'internal-server-error',
		code: 'internal-server-error',
		title: 'Internal Server Error',
		status: 500
	} as const

	const errorLike = { name: 'db', message: 'down', taken: true } as const

	const app = new Elysia()
		.onError(Taken, () => status(418, 'teapot' as const))
		.use(
			new Elysia()
				.get('/problem', () =>
					Math.random() > 0.5 ? status(500, own) : new Taken('x')
				)
				.get('/error-like', () =>
					Math.random() > 0.5
						? status(500, errorLike)
						: new Taken('x')
				)
				.get('/other', (): Taken | Later | 'ok' => {
					if (Math.random() > 0.5) return new Taken('x')
					if (Math.random() > 0.5) return new Later('x')
					return 'ok'
				})
		)

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['problem']['get']['response']>().toEqualTypeOf<{
		418: 'teapot'
		500: typeof own
	}>()
	expectTypeOf<Routes['error-like']['get']['response']>().toEqualTypeOf<{
		418: 'teapot'
		500: typeof errorLike
	}>()
	expectTypeOf<Routes['other']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		418: 'teapot'
		500: Unhandled500
	}>()
	expectTypeOf<Routes['other']['get']['error']>().toEqualTypeOf<Later>()

	// Nor when a parent takes over what the plugin handled itself, and the
	// remaining error is handled one level further up
	const nested = new Elysia()
		.onError(Later, () => status(410, 'gone' as const))
		.use(
			new Elysia()
				.onError(Taken, () => status(418, 'teapot' as const))
				.use(
					new Elysia()
						.onError(Taken, () => status(409, 'own' as const))
						.get(
							'/',
							(): Taken | Later | 'ok' | typeof ownStatus => {
								if (Math.random() > 0.5) return ownStatus
								if (Math.random() > 0.5) return new Taken('x')
								if (Math.random() > 0.5) return new Later('x')
								return 'ok'
							}
						)
				)
		)

	const ownStatus = status(500, own)

	expectTypeOf<
		(typeof nested)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		200: 'ok'
		410: 'gone'
		418: 'teapot'
		500: typeof own
	}>()
	expectTypeOf<
		(typeof nested)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()
}

// A parent's hook response joins the rebuilt response as well
{
	class Taken extends Error {
		readonly taken = true
	}

	const app = new Elysia()
		.onError(Taken, () => status(418, 'teapot' as const))
		.use(
			new Elysia()
				.onBeforeHandle(() => {
					if (Math.random() > 0.5) return status(401, 'no' as const)
				})
				.as('plugin')
				.use(
					new Elysia().get('/', (): Taken | 'ok' =>
						Math.random() > 0.5 ? new Taken('x') : 'ok'
					)
				)
		)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
		418: 'teapot'
	}>()
}

// A parent's `beforeHandle` error joins the route at `.use()`: the part a
// handler answers stays when a later handler takes the rest over, and so does
// the route's own 500
{
	class Taken extends Error {
		readonly taken = true
	}

	class Later extends Error {
		readonly later = true
	}

	const own = {
		type: 'internal-server-error',
		code: 'internal-server-error',
		title: 'Internal Server Error',
		status: 500
	} as const

	const parent = new Elysia()
		.onError(Taken, () => status(418, 'teapot' as const))
		.onBeforeHandle(({ request }) => {
			if (request.headers.has('x-taken')) return new Taken('x')
			if (request.headers.has('x-later')) return new Later('x')
		})
		.as('plugin')
		.use(
			new Elysia().get('/', () =>
				Math.random() > 0.5 ? status(500, own) : ('ok' as const)
			)
		)

	expectTypeOf<
		(typeof parent)['~Routes']['get']['error']
	>().toEqualTypeOf<Later>()

	const app = new Elysia()
		.onError(Later, () => status(410, 'gone' as const))
		.use(parent)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		410: 'gone'
		418: 'teapot'
		500: typeof own
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()
}

// A catch-all error hook, `.onError(fn)` or a route's own `error`, that never
// returns nothing answers every error that reaches it, returned ones too: the
// error leaves the route's type, and a plain value it answers with is served
// at that error's status, as a `.onError(Class)` handler's is. Each case is
// served at runtime by test/lifecycle/catch-all-error.test.ts
{
	class Lib extends Error {
		readonly lib = true
	}

	class Other extends Error {
		readonly other = true
	}

	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

	const route = new Elysia()
		.get(
			'/status',
			{ error: () => status(503, 'down' as const) },
			() => new Lib('x')
		)
		.get('/plain', { error: () => 'fallback' as const }, () => new Lib('x'))
		.get(
			'/credit',
			{ error: () => 'fallback' as const },
			() => new OutOfCredit()
		)
		.get(
			'/passes',
			{
				error: ({ error }) =>
					error instanceof Other ? undefined : ('fallback' as const)
			},
			() => new Lib('x')
		)

	type Route = (typeof route)['~Routes']

	expectTypeOf<Route['status']['get']['response']>().toEqualTypeOf<{
		503: 'down'
	}>()
	expectTypeOf<Route['status']['get']['error']>().toEqualTypeOf<never>()
	expectTypeOf<Route['plain']['get']['response']>().toEqualTypeOf<{
		500: 'fallback'
	}>()
	expectTypeOf<Route['credit']['get']['response']>().toEqualTypeOf<{
		402: 'fallback'
	}>()
	// one that may pass the error on handles nothing
	expectTypeOf<Route['passes']['get']['response']>().toEqualTypeOf<{
		500: Unhandled500 | 'fallback'
	}>()
	expectTypeOf<Route['passes']['get']['error']>().toEqualTypeOf<Lib>()

	// `.onError(fn)` the same, at any scope
	const instance = new Elysia()
		.onError(() => status(503, 'down' as const))
		.get('/', () => new Lib('x'))
	const plain = new Elysia()
		.onError('global', () => 'fallback' as const)
		.get('/', () => new OutOfCredit())

	expectTypeOf<
		(typeof instance)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 503: 'down' }>()
	expectTypeOf<
		(typeof instance)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()
	expectTypeOf<(typeof plain)['~Routes']['get']['response']>().toEqualTypeOf<{
		402: 'fallback'
	}>()

	// A thrown error stays out of the type, so a plain value adds nothing
	const thrown = new Elysia().get(
		'/',
		{ error: () => 'fallback' as const },
		(): string => {
			throw new Lib('x')
		}
	)

	expectTypeOf<
		(typeof thrown)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		200: string
	}>()

	// A validation error is caught too, and answered at 422. A class handler
	// may catch it first, matched structurally, so the default document stays
	const query = t.Object({ n: t.Numeric() })
	const validated = new Elysia()
		.get(
			'/route',
			{ query, error: () => 'fallback' as const },
			() => 'ok' as const
		)
		.onError(({ error }) => (error instanceof Other ? undefined : 'maybe'))
		.get('/passes', { query }, () => 'ok' as const)

	expectTypeOf<
		(typeof validated)['~Routes']['route']['get']['response']
	>().toEqualTypeOf<{
		200: 'ok'
		422: ValidationErrorResponse | 'fallback'
	}>()
	expectTypeOf<
		(typeof validated)['~Routes']['passes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 422: ValidationErrorResponse | 'maybe' }>()

	// Class handlers run in registration order, a route's own `error` hook
	// last. Which catch-all comes first isn't kept, so each may answer
	const classFirst = new Elysia()
		.onError(Lib, () => status(418, 'class' as const))
		.onError(() => status(503, 'all' as const))
		.get('/', () => new Lib('x'))
	const catchAllFirst = new Elysia()
		.onError(() => status(503, 'all' as const))
		.onError(Lib, () => status(418, 'class' as const))
		.get('/', () => new Lib('x'))

	// its `status()` joins every route after it, whatever the error
	expectTypeOf<
		(typeof classFirst)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 418: 'class'; 503: 'all' }>()
	expectTypeOf<
		(typeof catchAllFirst)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 418: 'class'; 503: 'all' }>()

	// A parent's handler registered before `.use()` runs before the plugin's
	// catch-all, so it takes the error over
	const takeover = new Elysia()
		.onError(Lib, () => status(418, 'parent' as const))
		.use(
			new Elysia()
				.get(
					'/route',
					{ error: () => status(503, 'route' as const) },
					() => new Lib('x')
				)
				.onError(() => status(503, 'plugin' as const))
				.get('/instance', () => new Lib('x'))
		)

	expectTypeOf<
		(typeof takeover)['~Routes']['route']['get']['response']
	>().toEqualTypeOf<{ 418: 'parent' }>()
	expectTypeOf<
		(typeof takeover)['~Routes']['instance']['get']['response']
	>().toEqualTypeOf<{ 418: 'parent' }>()
}

// When which handler answers first can't be told from the types, every one
// that may answer is in the route's type. Hooks are listed by scope, not in
// the order they run, so catch-alls of different scopes all may answer; a
// parent's handler that may pass the error on answers beside the plugin's;
// and a validation error may reach a class handler as well as a catch-all,
// so the default 422 stays beside them. Served at runtime by
// test/lifecycle/catch-all-error.test.ts
{
	class Lib extends Error {
		readonly lib = true
	}

	class Credit extends HTTPError.id('CREDIT', 402) {}

	const query = t.Object({ n: t.Numeric() })

	const mixedScope = new Elysia()
		.onError(() => 'local' as const)
		.onError('global', () => 'global' as const)
		.get('/', () => new Lib('x'))

	expectTypeOf<
		(typeof mixedScope)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 500: 'local' | 'global' }>()

	const parentMayPass = new Elysia()
		.onError(({ query }) => (query.pass ? undefined : ('parent' as const)))
		.use(
			new Elysia()
				.onError(() => 'child' as const)
				.get('/', () => new Lib('x'))
		)

	expectTypeOf<
		(typeof parentMayPass)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 500: 'parent' | 'child' }>()

	const classFirst = new Elysia()
		.onError(Error, () => status(409, 'class' as const))
		.onError(() => status(503, 'all' as const))
		.get('/', { query }, () => 'ok' as const)

	expectTypeOf<
		(typeof classFirst)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		200: 'ok'
		409: 'class'
		422: ValidationErrorResponse
		503: 'all'
	}>()

	// the response schema checks neither handler's answer
	const schema = new Elysia().get(
		'/',
		{
			query,
			error: () => 'fallback' as const,
			response: {
				200: t.Literal('ok'),
				422: t.Object({ why: t.String() })
			}
		},
		() => 'ok' as const
	)

	expectTypeOf<
		(typeof schema)['~Routes']['get']['response'][422]
	>().toEqualTypeOf<'fallback' | { why: string }>()

	const parentValidation = new Elysia()
		.onError(() => 'parent' as const)
		.use(
			new Elysia().get(
				'/',
				{ query, error: () => 'child' as const },
				() => 'ok' as const
			)
		)

	expectTypeOf<
		(typeof parentValidation)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		200: 'ok'
		422: ValidationErrorResponse | 'child' | 'parent'
	}>()

	// A WebSocket route's own `error` hook answers its upgrade too
	const ws = new Elysia()
		.use(websocket())
		.onError(() => 'app' as const)
		.ws('/', { query, error: () => 'own' as const, message: () => 'ok' })

	expectTypeOf<
		(typeof ws)['~Routes']['subscribe']['response']
	>().toEqualTypeOf<{ 422: ValidationErrorResponse | 'own' | 'app' }>()

	// `.guard()`, `.group()` and a macro's `error` hook catch it the same way
	const guard = new Elysia()
		.guard({ error: () => 'guard' as const })
		.get('/', () => new Credit())
	const group = new Elysia().group(
		'/group',
		{ error: () => 'group' as const },
		(app) => app.get('/', () => new Credit())
	)
	const macro = new Elysia()
		.macro({ rescue: { error: () => 'macro' as const } })
		.get('/', { rescue: true }, () => new Credit())
	const guardValidation = new Elysia()
		.guard({ error: () => 'guard' as const })
		.get('/', { query }, () => 'ok' as const)

	expectTypeOf<(typeof guard)['~Routes']['get']['response']>().toEqualTypeOf<{
		402: 'guard'
	}>()
	expectTypeOf<
		(typeof group)['~Routes']['group']['get']['response']
	>().toEqualTypeOf<{ 402: 'group' }>()
	expectTypeOf<(typeof macro)['~Routes']['get']['response']>().toEqualTypeOf<{
		402: 'macro'
	}>()
	expectTypeOf<
		(typeof guardValidation)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 422: ValidationErrorResponse | 'guard' }>()

	// A widened array may be empty, so it only may answer. A hook that never
	// returns throws, which is served as a plain 500. An `Error` it hands back
	// is served as an unhandled one at its own status, never dispatched again:
	// `Lib` has none, so the plain 500, not the caught error's 402
	const handlers: Array<() => 'array'> = [() => 'array']
	const array = new Elysia().onError(handlers).get('/', () => new Lib('x'))
	const throws = new Elysia()
		.onError((): never => {
			throw new Error('hook')
		})
		.get('/', () => new Lib('x'))
	const errorBack = new Elysia()
		.onError(() => new Lib('again'))
		.get('/', () => new Credit())

	expectTypeOf<(typeof array)['~Routes']['get']['response']>().toEqualTypeOf<{
		500: 'array' | Unhandled500
	}>()
	expectTypeOf<
		(typeof throws)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 500: Unhandled500 }>()
	expectTypeOf<
		(typeof errorBack)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 500: Unhandled500 }>()

	// A self-describing one keeps its own status and document, even beside a
	// handler for its class
	const credit = new Elysia()
		.onError(() => new Credit())
		.onError(Credit, () => status(418, 'credit' as const))
		.get('/', () => new Lib('x'))
	type CreditBack = (typeof credit)['~Routes']['get']['response']

	expectTypeOf<keyof CreditBack>().toEqualTypeOf<402>()
	expectTypeOf<CreditBack[402]['code']>().toEqualTypeOf<'CREDIT'>()

	// It answers any error, so it joins every route in scope, as a `status()`
	// the hook returns does. A route's own or a macro's `error` hook isn't
	// typed this way
	const anyError = new Elysia()
		.onError(() => new Credit())
		.get('/', () => 'ok' as const)
	const guardAny = new Elysia()
		.guard({ error: () => new Credit() })
		.get('/', () => 'ok' as const)
	type AnyError = (typeof anyError)['~Routes']['get']['response']

	expectTypeOf<keyof AnyError>().toEqualTypeOf<200 | 402>()
	expectTypeOf<AnyError[402]['code']>().toEqualTypeOf<'CREDIT'>()
	expectTypeOf<
		keyof (typeof guardAny)['~Routes']['get']['response']
	>().toEqualTypeOf<200 | 402>()
}

// A parent's handlers registered before `.use()` run before the plugin's, so
// one a validation error may reach answers a plugin route's 422 too: `Error`
// itself, and a class that adds nothing to `Error` (which may not be the one
// that answers, so the default document stays). A class with members of its
// own doesn't match. Served at runtime by
// test/lifecycle/error-class-match.test.ts
{
	class Empty extends Error {}
	class RateLimited extends HTTPError.id('RATE_LIMITED', 429) {}

	const query = t.Object({ n: t.Numeric() })
	const plugin = () => new Elysia().get('/', { query }, () => 'ok' as const)

	const error = new Elysia()
		.onError(Error, () => status(418, 'parent' as const))
		.use(plugin())
	const empty = new Elysia()
		.onError(Empty, () => status(401, 'empty' as const))
		.use(plugin())
	const member = new Elysia()
		.onError(RateLimited, () => status(418, 'limited' as const))
		.use(plugin())
	const late = new Elysia()
		.use(plugin())
		.onError(Error, () => status(418, 'late' as const))
	const deep = new Elysia()
		.onError(Error, () => status(418, 'top' as const))
		.use(new Elysia().use(plugin()))
	const both = new Elysia()
		.onError(Error, () => status(418, 'parent' as const))
		.use(
			new Elysia()
				.onError(Error, () => status(409, 'plugin' as const))
				.get('/', { query }, () => 'ok' as const)
		)
	const ws = new Elysia()
		.onError(Error, () => status(418, 'parent' as const))
		.use(
			new Elysia()
				.use(websocket())
				.ws('/', { query, message: () => 'ok' })
		)

	type Valid = { 200: 'ok'; 422: ValidationErrorResponse }

	expectTypeOf<(typeof error)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		418: 'parent'
		422: ValidationErrorResponse
	}>()
	expectTypeOf<(typeof empty)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'empty'
		422: ValidationErrorResponse
	}>()
	expectTypeOf<
		(typeof member)['~Routes']['get']['response']
	>().toEqualTypeOf<Valid>()
	expectTypeOf<
		(typeof late)['~Routes']['get']['response']
	>().toEqualTypeOf<Valid>()
	expectTypeOf<(typeof deep)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		418: 'top'
		422: ValidationErrorResponse
	}>()
	expectTypeOf<(typeof both)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		409: 'plugin'
		418: 'parent'
		422: ValidationErrorResponse
	}>()
	expectTypeOf<
		(typeof ws)['~Routes']['subscribe']['response']
	>().toEqualTypeOf<{ 418: 'parent'; 422: ValidationErrorResponse }>()

	// A route that doesn't validate gains nothing
	const plain = new Elysia()
		.onError(Error, () => status(418, 'parent' as const))
		.use(new Elysia().get('/', () => 'ok' as const))

	expectTypeOf<(typeof plain)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
	}>()
}
