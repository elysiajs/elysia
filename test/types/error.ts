/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, NotFound, status } from '../../src'

import { expectTypeOf } from 'expect-type'

/**
 * `.error(Class, handler)` type soundness
 *
 * Registered handlers land in scope channels as ordered
 * `{ error, response }` entries. A route returning a registered error maps
 * to the handler's response (the closest handler wins, mirroring runtime
 * hook order); an unmatched error is stored on the route's `error` field
 * and re-resolved as handlers register — Eden folds whatever remains into
 * the default 500. Thrown errors are invisible to TypeScript — returning
 * is the sound path.
 *
 * Custom errors need a distinguishing member (`kind` below): TypeScript is
 * structural, so a memberless `class X extends Error {}` is
 * indistinguishable from `Error` itself. Verified at runtime in
 * test/2/extends/error.test.ts
 */

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

// handler context narrows `error` to the registered class
{
	new Elysia().error(MyError, ({ error }) => {
		expectTypeOf(error).toEqualTypeOf<MyError>()
	})
}

// returned registered error maps to the handler's status() entry
{
	const app = new Elysia()
		.error(MyError, ({ error }) => status(404, { message: error.message }))
		.get('/', () => new MyError('Hello Error'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		404: { readonly message: string }
	}>()
}

// the 200 path survives alongside the mapped error
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

// an unmatched returned error is stored on the route's `error` field until
// a handler registers; Eden folds whatever remains into the default 500
{
	const app = new Elysia().get('/', () => new OtherError('x'))

	expectTypeOf<
		(typeof app)['~Routes']['get']['response']
	>().toEqualTypeOf<{}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<OtherError>()
}

// plain handler return maps to the error's declared status, default 500
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

// first registered match wins, mirroring runtime hook order
{
	const app = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.error(ChildError, () => status(403, 'child' as const))
		.get('/', () => new ChildError('x'))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		418: 'parent'
	}>()
}

// entries are scope-channeled like schemas: a plugin's local (default)
// handler maps only the plugin's own routes — the parent's routes fall back
// to the default 500, matching runtime hook scoping
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
	>().toEqualTypeOf<{}>()
	expectTypeOf<
		(typeof app)['~Routes']['outer']['get']['error']
	>().toEqualTypeOf<MyError>()
}

// 'plugin' scope maps the immediate parent but stops there
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
	>().toEqualTypeOf<{}>()
	expectTypeOf<
		(typeof grandparent)['~Routes']['get']['error']
	>().toEqualTypeOf<MyError>()
}

// 'global' scope maps at any depth
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

// catch-all `.error(fn)` does not contribute to route responses
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

// routes plugins do not need the handler applied to them: handlers cascade
// downward on use() and absorbed routes are re-resolved
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

// registration order does not matter, mirroring runtime: a handler
// registered after the route — even after use() — re-resolves it
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

// the closest handler wins: a plugin's own handler beats the parent's
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
