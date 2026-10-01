/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, status, t, type AnyElysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'

import { expectTypeOf } from 'expect-type'

// A parent's hooks registered before `.use()` run on the plugin's routes
// (test/lifecycle/nested-hook-order.test.ts), so what they respond with types
// on those routes as it does on a route the parent declares itself. Each case
// is served at runtime by test/lifecycle/parent-hook-response.test.ts

const deny = ({ request }: { request: Request }) =>
	request.headers.has('x-deny') ? status(401, 'no' as const) : undefined

const routes = () => new Elysia().get('/', () => 'ok' as const)

type Denied = { 200: 'ok'; 401: 'no' }

// A used route types exactly as the same route declared on the parent
{
	const used = new Elysia().beforeHandle(deny).use(routes())
	const direct = new Elysia().beforeHandle(deny).get('/', () => 'ok' as const)

	expectTypeOf<
		(typeof used)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<(typeof used)['~Routes']['get']>().toEqualTypeOf<
		(typeof direct)['~Routes']['get']
	>()
}

// Without parent hooks the plugin's route passes through untouched
{
	const plugin = routes()
	const used = new Elysia().use(plugin)

	expectTypeOf<(typeof used)['~Routes']['get']>().toEqualTypeOf<
		(typeof plugin)['~Routes']['get']
	>()
}

// A status both the route and the hook serve takes either body
{
	const used = new Elysia()
		.beforeHandle(deny)
		.use(
			new Elysia().get('/', ({ request }) =>
				request.headers.has('x-own')
					? status(401, 'own' as const)
					: 'ok'
			)
		)

	expectTypeOf<(typeof used)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'own' | 'no'
	}>()
}

// Every scope applies
{
	const scoped = new Elysia().beforeHandle('plugin', deny).use(routes())
	const global = new Elysia().beforeHandle('global', deny).use(routes())

	expectTypeOf<
		(typeof scoped)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<
		(typeof global)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()
}

// derive / afterHandle returning a status
{
	const derived = new Elysia()
		.derive(({ request }) => {
			if (request.headers.has('x-deny')) return status(401, 'derive')

			return { user: 'saltyaom' }
		})
		.use(routes())

	expectTypeOf<
		(typeof derived)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 401: 'derive' }>()

	const after = new Elysia()
		.afterHandle(({ request }) =>
			request.headers.has('x-deny')
				? status(401, 'after' as const)
				: undefined
		)
		.use(routes())

	expectTypeOf<(typeof after)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'after'
	}>()
}

// Nesting: a root's and an intermediate plugin's hooks registered before
// their `.use()` both apply
{
	const root = new Elysia().beforeHandle(deny).use(new Elysia().use(routes()))

	expectTypeOf<
		(typeof root)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()

	const intermediate = new Elysia().use(
		new Elysia()
			.beforeHandle(({ request }) =>
				request.headers.has('x-mid')
					? status(402, 'mid' as const)
					: undefined
			)
			.use(routes())
	)

	expectTypeOf<
		(typeof intermediate)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 402: 'mid' }>()

	const both = new Elysia()
		.beforeHandle(deny)
		.use(
			new Elysia()
				.beforeHandle(({ request }) =>
					request.headers.has('x-mid')
						? status(402, 'mid' as const)
						: undefined
				)
				.use(routes())
		)

	expectTypeOf<(typeof both)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
		402: 'mid'
	}>()
}

// Guard and group
{
	const guarded = new Elysia().guard({ beforeHandle: deny }, (app) =>
		app.use(routes())
	)
	const standalone = new Elysia().guard({ beforeHandle: deny }).use(routes())
	const aroundGuard = new Elysia()
		.beforeHandle(deny)
		.guard({}, (app) => app.use(routes()))
	const aroundGroup = new Elysia()
		.beforeHandle(deny)
		.group('/g', (app) => app.use(routes()))
	const inGroup = new Elysia().group('/g', (app) =>
		app.beforeHandle(deny).use(routes())
	)

	expectTypeOf<
		(typeof guarded)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<
		(typeof standalone)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<
		(typeof aroundGuard)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<
		(typeof aroundGroup)['~Routes']['g']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<
		(typeof inGroup)['~Routes']['g']['get']['response']
	>().toEqualTypeOf<Denied>()
}

// Prefixed parent, array `.use()` and an async plugin instance
{
	const prefixed = new Elysia({ prefix: '/api' })
		.beforeHandle(deny)
		.use(routes())
	const array = new Elysia().beforeHandle(deny).use([routes()])
	const prefixedArray = new Elysia({ prefix: '/api' })
		.beforeHandle(deny)
		.use([routes()])
	const lazy = new Elysia().beforeHandle(deny).use(Promise.resolve(routes()))
	const prefixedLazy = new Elysia({ prefix: '/api' })
		.beforeHandle(deny)
		.use(Promise.resolve(routes()))

	expectTypeOf<
		(typeof prefixed)['~Routes']['api']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<
		(typeof array)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<
		(typeof prefixedArray)['~Routes']['api']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<
		(typeof lazy)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()
	expectTypeOf<
		(typeof prefixedLazy)['~Routes']['api']['get']['response']
	>().toEqualTypeOf<Denied>()
}

// An earlier sibling's plugin-scoped and global hooks reach a later
// sibling's routes; its local hooks don't
{
	const forbid = ({ request }: { request: Request }) =>
		request.headers.has('x-sibling')
			? status(403, 'sibling' as const)
			: undefined

	const scoped = new Elysia()
		.use(new Elysia().beforeHandle('plugin', forbid))
		.use(routes())
	const global = new Elysia()
		.use(new Elysia().beforeHandle('global', forbid))
		.use(routes())
	const local = new Elysia()
		.use(new Elysia().beforeHandle(forbid))
		.use(routes())
	const array = new Elysia().use([
		new Elysia().beforeHandle('plugin', forbid),
		routes()
	])

	expectTypeOf<
		(typeof scoped)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 403: 'sibling' }>()
	expectTypeOf<
		(typeof global)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 403: 'sibling' }>()
	expectTypeOf<(typeof local)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
	}>()
	expectTypeOf<(typeof array)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		403: 'sibling'
	}>()
}

// A parent class handler taking over the plugin's error leaves the parent
// hook's response alone, even one equal to what the plugin's handler served
{
	class MyError extends Error {
		readonly kind = 'my-error'
	}

	const app = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.beforeHandle(({ request }) =>
			request.headers.has('x-deny')
				? status(403, 'plugin' as const)
				: undefined
		)
		.use(
			new Elysia()
				.error(MyError, () => status(403, 'plugin' as const))
				.get('/', () => new MyError('x'))
		)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: 'plugin'
		418: 'parent'
	}>()
}

// Not typed: a local hook registered after `.use()` runs on the plugin's
// routes, at any nesting level, but not on routes the instance declared
// itself before it, so it can't join every route the same way. Plugin-scoped
// and global hooks after `.use()` don't run on them at all
{
	const local = new Elysia().use(routes()).beforeHandle(deny)
	const scoped = new Elysia().use(routes()).beforeHandle('plugin', deny)
	const global = new Elysia().use(routes()).beforeHandle('global', deny)
	const intermediate = new Elysia().use(
		new Elysia().use(routes()).beforeHandle(deny)
	)

	expectTypeOf<(typeof local)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
	}>()
	expectTypeOf<
		(typeof scoped)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok' }>()
	expectTypeOf<
		(typeof global)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok' }>()
	expectTypeOf<
		(typeof intermediate)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok' }>()
}

// A used WebSocket route: the parent's beforeHandle rejects its upgrade, so
// it types like one the parent declares itself. A parent class handler
// leaves it alone, schema types (a `Date` body) included
{
	class MyError extends Error {
		readonly kind = 'my-error'
	}

	const ws = () =>
		new Elysia().ws('/ws', {
			body: t.Object({ at: t.Date() }),
			message() {}
		})

	const hooked = new Elysia().use(websocket()).beforeHandle(deny).use(ws())
	const direct = new Elysia()
		.use(websocket())
		.beforeHandle(deny)
		.ws('/ws', {
			body: t.Object({ at: t.Date() }),
			message() {}
		})
	const handled = new Elysia()
		.use(websocket())
		.error(MyError, () => status(418, 'parent' as const))
		.use(ws())

	expectTypeOf<
		(typeof hooked)['~Routes']['ws']['subscribe']['response'][401]
	>().toEqualTypeOf<'no'>()
	expectTypeOf<(typeof hooked)['~Routes']['ws']['subscribe']>().toEqualTypeOf<
		(typeof direct)['~Routes']['ws']['subscribe']
	>()
	expectTypeOf<
		(typeof handled)['~Routes']['ws']['subscribe']
	>().toEqualTypeOf<ReturnType<typeof ws>['~Routes']['ws']['subscribe']>()
}

// A plugin typed as `AnyElysia` keeps its `any` routes under parent hooks
// and handlers
{
	class MyError extends Error {
		readonly kind = 'my-error'
	}

	const loose = new Elysia() as AnyElysia

	const hooked = new Elysia().beforeHandle(deny).use(loose)
	const handled = new Elysia()
		.error(MyError, () => status(418, 'parent' as const))
		.use(loose)

	expectTypeOf<(typeof hooked)['~Routes']>().toBeAny()
	expectTypeOf<(typeof handled)['~Routes']>().toBeAny()
}
