/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, HTTPError, status, t, type AnyElysia } from '../../src'
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

// A used route types exactly as the same route declared on the parent
{
	const used = new Elysia().onBeforeHandle(deny).use(routes())
	const direct = new Elysia()
		.onBeforeHandle(deny)
		.get('/', () => 'ok' as const)

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
		.onBeforeHandle(deny)
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
	const scoped = new Elysia().onBeforeHandle('plugin', deny).use(routes())
	const global = new Elysia().onBeforeHandle('global', deny).use(routes())

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
		.onAfterHandle(({ request }) =>
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
	const root = new Elysia()
		.onBeforeHandle(deny)
		.use(new Elysia().use(routes()))

	expectTypeOf<
		(typeof root)['~Routes']['get']['response']
	>().toEqualTypeOf<Denied>()

	const intermediate = new Elysia().use(
		new Elysia()
			.onBeforeHandle(({ request }) =>
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
		.onBeforeHandle(deny)
		.use(
			new Elysia()
				.onBeforeHandle(({ request }) =>
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
		.onBeforeHandle(deny)
		.guard({}, (app) => app.use(routes()))
	const aroundGroup = new Elysia()
		.onBeforeHandle(deny)
		.group('/g', (app) => app.use(routes()))
	const inGroup = new Elysia().group('/g', (app) =>
		app.onBeforeHandle(deny).use(routes())
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
		.onBeforeHandle(deny)
		.use(routes())
	const array = new Elysia().onBeforeHandle(deny).use([routes()])
	const prefixedArray = new Elysia({ prefix: '/api' })
		.onBeforeHandle(deny)
		.use([routes()])
	const lazy = new Elysia()
		.onBeforeHandle(deny)
		.use(Promise.resolve(routes()))
	const prefixedLazy = new Elysia({ prefix: '/api' })
		.onBeforeHandle(deny)
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
		.use(new Elysia().onBeforeHandle('plugin', forbid))
		.use(routes())
	const global = new Elysia()
		.use(new Elysia().onBeforeHandle('global', forbid))
		.use(routes())
	const local = new Elysia()
		.use(new Elysia().onBeforeHandle(forbid))
		.use(routes())
	const array = new Elysia().use([
		new Elysia().onBeforeHandle('plugin', forbid),
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
		.onError(MyError, () => status(418, 'parent' as const))
		.onBeforeHandle(({ request }) =>
			request.headers.has('x-deny')
				? status(403, 'plugin' as const)
				: undefined
		)
		.use(
			new Elysia()
				.onError(MyError, () => status(403, 'plugin' as const))
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
	const local = new Elysia().use(routes()).onBeforeHandle(deny)
	const scoped = new Elysia().use(routes()).onBeforeHandle('plugin', deny)
	const global = new Elysia().use(routes()).onBeforeHandle('global', deny)
	const intermediate = new Elysia().use(
		new Elysia().use(routes()).onBeforeHandle(deny)
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

	const hooked = new Elysia().use(websocket()).onBeforeHandle(deny).use(ws())
	const direct = new Elysia()
		.use(websocket())
		.onBeforeHandle(deny)
		.ws('/ws', {
			body: t.Object({ at: t.Date() }),
			message() {}
		})
	const handled = new Elysia()
		.use(websocket())
		.onError(MyError, () => status(418, 'parent' as const))
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

	const hooked = new Elysia().onBeforeHandle(deny).use(loose)
	const handled = new Elysia()
		.onError(MyError, () => status(418, 'parent' as const))
		.use(loose)

	expectTypeOf<(typeof hooked)['~Routes']>().toBeAny()
	expectTypeOf<(typeof handled)['~Routes']>().toBeAny()
}

// A raw `Error` a `beforeHandle` returns goes back through `.onError(Class)`
// dispatch at runtime, the same as one the handler returns, so it joins the
// route's `error` and resolves against the handlers registered before the
// route. Other hooks' raw `Error`s are served as an unhandled 500 instead
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}
	class Lib extends Error {}

	const credit = ({ request }: { request: Request }) =>
		request.headers.has('x-credit') ? new OutOfCredit() : undefined
	const teapot = () => status(418, 'teapot' as const)

	// What the handler returning the same error types as
	const handler = new Elysia().get('/', ({ request }) =>
		request.headers.has('x-credit') ? new OutOfCredit() : ('ok' as const)
	)
	type Handler = (typeof handler)['~Routes']['get']

	const local = new Elysia()
		.onBeforeHandle(credit)
		.get('/', () => 'ok' as const)
	const localScope = new Elysia()
		.onBeforeHandle('local', credit)
		.get('/', () => 'ok' as const)
	const scoped = new Elysia()
		.onBeforeHandle('plugin', credit)
		.get('/', () => 'ok' as const)
	const global = new Elysia()
		.onBeforeHandle('global', credit)
		.get('/', () => 'ok' as const)
	const guarded = new Elysia()
		.guard({ beforeHandle: credit })
		.get('/', () => 'ok' as const)
	const array = new Elysia()
		.onBeforeHandle([() => {}, credit])
		.get('/', () => 'ok' as const)

	expectTypeOf<(typeof local)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<
		(typeof localScope)['~Routes']['get']
	>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof scoped)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof global)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof guarded)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof array)['~Routes']['get']>().toEqualTypeOf<Handler>()

	expectTypeOf<
		keyof (typeof local)['~Routes']['get']['response']
	>().toEqualTypeOf<200 | 402>()
	expectTypeOf<
		(typeof local)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit>()

	// A handler registered before the route takes it, before or after the
	// hook. One registered after the route doesn't run for it
	const handledBefore = new Elysia()
		.onError(OutOfCredit, teapot)
		.onBeforeHandle(credit)
		.get('/', () => 'ok' as const)
	const handledAfter = new Elysia()
		.onBeforeHandle(credit)
		.onError(OutOfCredit, teapot)
		.get('/', () => 'ok' as const)
	const tooLate = new Elysia()
		.onBeforeHandle(credit)
		.get('/', () => 'ok' as const)
		.onError(OutOfCredit, teapot)

	type Handled = { response: { 200: 'ok'; 418: 'teapot' }; error: never }

	expectTypeOf<
		Pick<(typeof handledBefore)['~Routes']['get'], 'response' | 'error'>
	>().toEqualTypeOf<Handled>()
	expectTypeOf<
		Pick<(typeof handledAfter)['~Routes']['get'], 'response' | 'error'>
	>().toEqualTypeOf<Handled>()
	expectTypeOf<(typeof tooLate)['~Routes']['get']>().toEqualTypeOf<Handler>()

	// The handler's answer is never checked against the response schema, so
	// at a status the schema declares too, either can be served
	const collides = new Elysia()
		.onError(OutOfCredit, teapot)
		.onBeforeHandle(credit)
		.get(
			'/',
			{
				response: {
					200: t.Literal('ok'),
					418: t.Object({ x: t.String() })
				}
			},
			() => 'ok' as const
		)

	expectTypeOf<
		(typeof collides)['~Routes']['get']['response'][418]
	>().toEqualTypeOf<{ x: string } | 'teapot'>()

	// A plain error is an unhandled 500, the same as the handler's
	const lib = new Elysia()
		.onBeforeHandle(({ request }) =>
			request.headers.has('x-lib') ? new Lib('x') : undefined
		)
		.get('/', () => 'ok' as const)

	expectTypeOf<(typeof lib)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		500: Unhandled500
	}>()
	expectTypeOf<(typeof lib)['~Routes']['get']['error']>().toEqualTypeOf<Lib>()

	// Hooks that all apply union their errors: a guard's own `beforeHandle`
	// beside a macro's, and a parent's global hook beside a plugin's
	class Overdrawn extends HTTPError.id('OVERDRAWN', 402) {}

	const overdrawn = ({ request }: { request: Request }) =>
		request.headers.has('x-overdrawn') ? new Overdrawn() : undefined

	const withMacro = new Elysia()
		.macro({ funds: { beforeHandle: overdrawn } })
		.guard({ funds: true, beforeHandle: credit })
		.get('/', () => 'ok' as const)
	const globals = new Elysia()
		.onBeforeHandle('global', overdrawn)
		.use(new Elysia().onBeforeHandle('global', credit))
		.get('/', () => 'ok' as const)
	const siblings = new Elysia()
		.onBeforeHandle(overdrawn)
		.use(new Elysia().onBeforeHandle('plugin', credit))
		.get('/', () => 'ok' as const)
	const siblingArray = new Elysia()
		.onBeforeHandle(overdrawn)
		.use([
			new Elysia().onBeforeHandle('plugin', credit),
			new Elysia().get('/', () => 'ok' as const)
		])
	const globalArray = new Elysia()
		.onBeforeHandle('global', overdrawn)
		.use([new Elysia().onBeforeHandle('global', credit)])
		.get('/', () => 'ok' as const)
	const aroundGuard = new Elysia()
		.onBeforeHandle('global', overdrawn)
		.guard({ beforeHandle: credit }, (app) =>
			app.get('/', () => 'ok' as const)
		)

	expectTypeOf<(typeof withMacro)['~Routes']['get']['error']>().toEqualTypeOf<
		OutOfCredit | Overdrawn
	>()
	expectTypeOf<(typeof globals)['~Routes']['get']['error']>().toEqualTypeOf<
		OutOfCredit | Overdrawn
	>()
	expectTypeOf<(typeof siblings)['~Routes']['get']['error']>().toEqualTypeOf<
		OutOfCredit | Overdrawn
	>()
	expectTypeOf<
		(typeof siblingArray)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit | Overdrawn>()
	expectTypeOf<
		(typeof globalArray)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit | Overdrawn>()
	expectTypeOf<
		(typeof aroundGuard)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit | Overdrawn>()
	expectTypeOf<
		(typeof globals)['~Routes']['get']['response'][402]['code']
	>().toEqualTypeOf<'OUT_OF_CREDIT' | 'OVERDRAWN'>()
}

// Across `.use()`, a hook's raw `Error` resolves like the handler's: a
// parent's handler registered before `.use()` runs first
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

	const credit = ({ request }: { request: Request }) =>
		request.headers.has('x-credit') ? new OutOfCredit() : undefined

	type Parent = { response: { 200: 'ok'; 418: 'parent' }; error: never }
	type Leaf<App> = App extends {
		'~Routes': { get: { response: infer Response; error: infer Err } }
	}
		? { response: Response; error: Err }
		: never

	// The plugin's own hook
	const own = new Elysia()
		.onError(OutOfCredit, () => status(418, 'parent' as const))
		.use(new Elysia().onBeforeHandle(credit).get('/', () => 'ok' as const))
	// The parent's hook, every scope
	const parentHook = new Elysia()
		.onError(OutOfCredit, () => status(418, 'parent' as const))
		.onBeforeHandle(credit)
		.use(routes())
	const parentGlobal = new Elysia()
		.onError(OutOfCredit, () => status(418, 'parent' as const))
		.onBeforeHandle('global', credit)
		.use(routes())
	// An earlier sibling's plugin-scoped hook
	const sibling = new Elysia()
		.onError(OutOfCredit, () => status(418, 'parent' as const))
		.use(new Elysia().onBeforeHandle('plugin', credit))
		.get('/', () => 'ok' as const)
	// The plugin handles it too: the parent's handler still runs first
	const both = new Elysia()
		.onError(OutOfCredit, () => status(418, 'parent' as const))
		.use(
			new Elysia()
				.onBeforeHandle(credit)
				.onError(OutOfCredit, () => status(418, 'plugin' as const))
				.get('/', () => 'ok' as const)
		)

	expectTypeOf<Leaf<typeof own>>().toEqualTypeOf<Parent>()
	expectTypeOf<Leaf<typeof parentHook>>().toEqualTypeOf<Parent>()
	expectTypeOf<Leaf<typeof parentGlobal>>().toEqualTypeOf<Parent>()
	expectTypeOf<Leaf<typeof sibling>>().toEqualTypeOf<Parent>()
	expectTypeOf<Leaf<typeof both>>().toEqualTypeOf<Parent>()

	// Unhandled, the parent's hook types on the plugin's route the same as
	// the handler returning the error
	const unhandled = new Elysia().onBeforeHandle(credit).use(routes())
	const handler = new Elysia().get('/', ({ request }) =>
		request.headers.has('x-credit') ? new OutOfCredit() : ('ok' as const)
	)

	expectTypeOf<Leaf<typeof unhandled>>().toEqualTypeOf<Leaf<typeof handler>>()

	// Not typed: at runtime the parent's handlers registered before `.use()`
	// run first, then the ones the plugin registered before its route (or an
	// intermediate plugin before its own `.use()`). With none on the parent,
	// the plugin's catches it here (418 'plugin'), but a route doesn't carry
	// the handlers it was declared under, so the error stays unhandled
	const pluginHandles = new Elysia()
		.onBeforeHandle(credit)
		.use(
			new Elysia()
				.onError(OutOfCredit, () => status(418, 'plugin' as const))
				.get('/', () => 'ok' as const)
		)

	expectTypeOf<
		keyof (typeof pluginHandles)['~Routes']['get']['response']
	>().toEqualTypeOf<200 | 402>()
	expectTypeOf<
		(typeof pluginHandles)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit>()

	// A parent handler that may pass the error on (returns nothing) runs
	// before the plugin's, so either can answer (418 or 419). Taking the error
	// over needs one that always answers. The same holds for an error the
	// plugin's handler returns
	const parentMayPass = new Elysia()
		.onError(OutOfCredit, ({ request }) =>
			request.headers.has('x-parent')
				? status(418, 'parent' as const)
				: undefined
		)
		.use(
			new Elysia()
				.onBeforeHandle(credit)
				.onError(OutOfCredit, () => status(419, 'plugin' as const))
				.get('/', () => 'ok' as const)
		)

	expectTypeOf<Leaf<typeof parentMayPass>>().toEqualTypeOf<{
		response: { 200: 'ok'; 418: 'parent'; 419: 'plugin' }
		error: never
	}>()

	// An async factory without `app` can't hand back the parent, so what it
	// resolves to is used as a plugin, the same as a promised instance or
	// module. One taking `app` is typed as returning it: its routes were
	// declared on the parent already, under the hooks registered before them
	const factory = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use(async () => routes())
	const promised = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use(Promise.resolve(routes()))
	const imported = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use(async () => ({ default: routes() }))
	const onParent = new Elysia()
		.get('/before', () => 'before' as const)
		.onBeforeHandle(credit)
		.use(async (app) => app.get('/', () => 'ok' as const))

	expectTypeOf<Leaf<typeof factory>>().toEqualTypeOf<Leaf<typeof promised>>()
	expectTypeOf<Leaf<typeof imported>>().toEqualTypeOf<Leaf<typeof promised>>()
	expectTypeOf<
		(typeof factory)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit>()
	expectTypeOf<
		(typeof onParent)['~Routes']['before']['get']['response']
	>().toEqualTypeOf<{ 200: 'before' }>()
	expectTypeOf<
		(typeof onParent)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit>()

	// The parent keeps its own handlers: the plugin doesn't replace them
	const keepsHandler = new Elysia()
		.onError(OutOfCredit, () => status(418, 'parent' as const))
		.use(async () => new Elysia())
		.get('/', () => new OutOfCredit())

	expectTypeOf<Leaf<typeof keepsHandler>>().toEqualTypeOf<{
		response: { 418: 'parent' }
		error: never
	}>()

	// Not typed: a factory taking `app` but resolving to a new instance is
	// still read as returning `app`, so the parent's hooks don't reach the
	// plugin's routes in the type, though they run on them (402 and 401)
	const ignoresApp = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use(async (_app) => routes())

	expectTypeOf<Leaf<typeof ignoresApp>>().toEqualTypeOf<{
		response: { 200: 'ok' }
		error: never
	}>()

	// A parameter with a default is handed the parent all the same, so what
	// the factory adds to it is the parent's: the derive is there, optional
	// until the factory resolves
	const defaulted = new Elysia()
	defaulted
		.use(async (app = defaulted) =>
			app.derive(() => ({ token: 'ok' as const }))
		)
		.get('/', ({ token }) => {
			expectTypeOf(token).toEqualTypeOf<'ok' | undefined>()

			return 'ok'
		})

	// Not typed: a factory that ignores `app` but resolves to the parent it
	// captured is read as a new plugin, types can't see instance identity.
	// The parent's hook then types on its earlier route, where it doesn't run
	// (200), and what the factory added to the parent is lost
	const captured = new Elysia()
		.get('/before', () => 'before' as const)
		.onBeforeHandle(deny)
	const capturedRoutes = captured.use(async () =>
		captured.get('/after', () => 'after' as const)
	)

	expectTypeOf<
		keyof (typeof capturedRoutes)['~Routes']['before']['get']['response']
	>().toEqualTypeOf<200 | 401>()

	const capturedDerive = new Elysia()
	capturedDerive
		.use(async () =>
			capturedDerive.derive(() => ({ token: 'ok' as const }))
		)
		// @ts-expect-error the derive the factory added is lost
		.get('/', ({ token }) => token)

	// The same split holds for a sync factory: one ignoring `app` returns a
	// new instance used as a plugin, one taking `app` returns the parent
	const syncFactory = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use(() => routes())
	const instance = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use(routes())
	const syncOnParent = new Elysia()
		.get('/before', () => 'before' as const)
		.onBeforeHandle(credit)
		.use((app) => app.get('/', () => 'ok' as const))
	const syncKeepsHandler = new Elysia()
		.onError(OutOfCredit, () => status(418, 'parent' as const))
		.use(() => new Elysia())
		.get('/', () => new OutOfCredit())
	const syncDefaulted = new Elysia()
	syncDefaulted
		.use((app = syncDefaulted) => app.decorate('token', 'ok' as const))
		.get('/', ({ token }) => token)

	expectTypeOf<Leaf<typeof syncFactory>>().toEqualTypeOf<
		Leaf<typeof instance>
	>()
	expectTypeOf<
		(typeof syncOnParent)['~Routes']['before']['get']['response']
	>().toEqualTypeOf<{ 200: 'before' }>()
	expectTypeOf<
		(typeof syncOnParent)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit>()
	expectTypeOf<Leaf<typeof syncKeepsHandler>>().toEqualTypeOf<{
		response: { 418: 'parent' }
		error: never
	}>()

	// A factory may return a module or several instances: each is used as a
	// plugin, the same as `.use()` of what it returns
	const syncModule = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use(() => ({ default: routes() }))
	const syncList = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use((app) => [routes()])
	const list = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use([routes()])
	const syncListAsConst = new Elysia()
		.onBeforeHandle(credit)
		.onBeforeHandle(deny)
		.use(() => [routes()] as const)

	expectTypeOf<Leaf<typeof syncModule>>().toEqualTypeOf<
		Leaf<typeof instance>
	>()
	expectTypeOf<Leaf<typeof syncList>>().toEqualTypeOf<Leaf<typeof list>>()
	expectTypeOf<Leaf<typeof syncListAsConst>>().toEqualTypeOf<
		Leaf<typeof list>
	>()

	new Elysia()
		.use(() => ({
			default: new Elysia().decorate('token', 'ok' as const)
		}))
		.get('/', ({ token }) => token)

	// Not typed: a factory taking no `app` has the array it returns inferred
	// before the overload for arrays sees it, as an array rather than a tuple,
	// so its plugins are lost though they're registered. `as const` keeps them
	const syncListUntyped = new Elysia().use(() => [routes()])

	expectTypeOf<
		'get' extends keyof (typeof syncListUntyped)['~Routes'] ? true : false
	>().toEqualTypeOf<false>()

	// A WebSocket route keeps no `~error` carrier: the hook's error resolves
	// into its response (below)
	const ws = new Elysia()
		.use(websocket())
		.onBeforeHandle(credit)
		.use(new Elysia().ws('/ws', { message() {} }))
		.ws('/own', { message() {} })

	expectTypeOf<
		'~error' extends keyof (typeof ws)['~Routes']['ws']['subscribe']['response']
			? true
			: false
	>().toEqualTypeOf<false>()
	expectTypeOf<
		'~error' extends keyof (typeof ws)['~Routes']['own']['subscribe']['response']
			? true
			: false
	>().toEqualTypeOf<false>()
}

// A macro's `beforeHandle` applies inside a guard or group callback too
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

	const auth = () =>
		new Elysia().macro({
			auth: {
				beforeHandle: ({ request }: { request: Request }) => {
					if (request.headers.has('x-credit'))
						return new OutOfCredit()
					if (request.headers.has('x-deny'))
						return status(401, 'no' as const)
				}
			}
		})

	const direct = auth()
		.guard({ auth: true })
		.get('/', () => 'ok' as const)
	const guarded = auth().guard({ auth: true }, (app) =>
		app.get('/', () => 'ok' as const)
	)
	const grouped = auth().group('/g', { auth: true }, (app) =>
		app.get('/', () => 'ok' as const)
	)

	type Direct = (typeof direct)['~Routes']['get']

	expectTypeOf<keyof Direct['response']>().toEqualTypeOf<200 | 401 | 402>()
	expectTypeOf<(typeof guarded)['~Routes']['get']>().toEqualTypeOf<Direct>()
	expectTypeOf<
		(typeof grouped)['~Routes']['g']['get']
	>().toEqualTypeOf<Direct>()
}

// A guard's hooks are runtime alternatives, so a status two of them serve
// takes either body instead of dropping out of the route's type
{
	const afterHandle = () => status(409, 'guard-after' as const)
	const error = () => status(409, 'guard-error' as const)

	const direct = new Elysia()
		.guard({ afterHandle, error })
		.get('/', () => 'ok' as const)
	const guarded = new Elysia().guard({ afterHandle, error }, (app) =>
		app.get('/', () => 'ok' as const)
	)
	const grouped = new Elysia().group('/g', { afterHandle, error }, (app) =>
		app.get('/', () => 'ok' as const)
	)

	type Both = { 200: 'ok'; 409: 'guard-after' | 'guard-error' }

	expectTypeOf<
		(typeof direct)['~Routes']['get']['response']
	>().toEqualTypeOf<Both>()
	expectTypeOf<
		(typeof guarded)['~Routes']['get']['response']
	>().toEqualTypeOf<Both>()
	expectTypeOf<
		(typeof grouped)['~Routes']['g']['get']['response']
	>().toEqualTypeOf<Both>()
}

// A macro's `beforeHandle` and the guard's own `error` serving one status do too
{
	const guarded = new Elysia()
		.macro({
			m: {
				beforeHandle() {
					if (Math.random()) return status(409, 'macro' as const)
				}
			}
		})
		.guard({ m: true, error: () => status(409, 'guard-error' as const) })
		.get('/', () => 'ok' as const)

	expectTypeOf<
		(typeof guarded)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 409: 'macro' | 'guard-error' }>()
}

// A raw `Error` a `derive` returns answers like a `beforeHandle`'s: through
// `.onError(Class)` dispatch, never derived into the context. Served at
// runtime by test/lifecycle/derive-returned-error.test.ts
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}
	class Lib extends Error {}

	const credit = ({ request }: { request: Request }) =>
		request.headers.has('x-credit')
			? new OutOfCredit()
			: { user: 'u' as const }
	const teapot = () => status(418, 'teapot' as const)

	// What the handler returning the same error types as
	const handler = new Elysia().get('/', ({ request }) =>
		request.headers.has('x-credit') ? new OutOfCredit() : ('u' as const)
	)
	type Handler = (typeof handler)['~Routes']['get']

	const local = new Elysia().derive(credit).get('/', ({ user }) => user)
	const localScope = new Elysia()
		.derive('local', credit)
		.get('/', ({ user }) => user)
	const async = new Elysia()
		.derive(async (context) => credit(context))
		.get('/', ({ user }) => user)
	const mapped = new Elysia().mapDerive(credit).get('/', ({ user }) => user)
	const scoped = new Elysia()
		.use(new Elysia().derive('plugin', credit))
		.get('/', ({ user }) => user)
	const global = new Elysia()
		.derive('global', credit)
		.use(new Elysia().get('/', () => 'u' as const))

	expectTypeOf<(typeof local)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<
		(typeof localScope)['~Routes']['get']
	>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof async)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof mapped)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof scoped)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<
		Pick<(typeof global)['~Routes']['get'], 'response' | 'error'>
	>().toEqualTypeOf<Pick<Handler, 'response' | 'error'>>()

	// The handler only runs when the derive didn't return the error
	new Elysia().derive(credit).get('/', (context) => {
		expectTypeOf(context.user).toEqualTypeOf<'u'>()
		expectTypeOf(context).not.toHaveProperty('stack')
	})

	// A handler registered before the route takes it, before or after the
	// derive. One registered after the route doesn't run for it
	const handledBefore = new Elysia()
		.onError(OutOfCredit, teapot)
		.derive(credit)
		.get('/', ({ user }) => user)
	const handledAfter = new Elysia()
		.derive(credit)
		.onError(OutOfCredit, teapot)
		.get('/', ({ user }) => user)
	const tooLate = new Elysia()
		.derive(credit)
		.get('/', ({ user }) => user)
		.onError(OutOfCredit, teapot)

	type Handled = { response: { 200: 'u'; 418: 'teapot' }; error: never }

	expectTypeOf<
		Pick<(typeof handledBefore)['~Routes']['get'], 'response' | 'error'>
	>().toEqualTypeOf<Handled>()
	expectTypeOf<
		Pick<(typeof handledAfter)['~Routes']['get'], 'response' | 'error'>
	>().toEqualTypeOf<Handled>()
	expectTypeOf<(typeof tooLate)['~Routes']['get']>().toEqualTypeOf<Handler>()

	// A plain error is an unhandled 500, a status() keeps its own status
	const lib = new Elysia()
		.derive(({ request }) =>
			request.headers.has('x-lib')
				? new Lib('x')
				: request.headers.has('x-auth')
					? status(401, 'no' as const)
					: { user: 'u' as const }
		)
		.get('/', ({ user }) => user)

	expectTypeOf<(typeof lib)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'u'
		401: 'no'
		500: Unhandled500
	}>()
	expectTypeOf<(typeof lib)['~Routes']['get']['error']>().toEqualTypeOf<Lib>()

	// A parent's handler registered before `.use()` resolves its global
	// derive's error on the plugin's route
	const parent = new Elysia()
		.onError(OutOfCredit, teapot)
		.derive('global', credit)
		.use(new Elysia().get('/', () => 'u' as const))

	expectTypeOf<
		Pick<(typeof parent)['~Routes']['get'], 'response' | 'error'>
	>().toEqualTypeOf<Handled>()

	// On a WebSocket upgrade a derive's error is dispatched, as a
	// beforeHandle's is
	const ws = new Elysia()
		.use(websocket())
		.derive(credit)
		.ws('/', { message() {} })
	const wsBeforeHandle = new Elysia()
		.use(websocket())
		.onBeforeHandle(({ request }) =>
			request.headers.has('x-credit') ? new OutOfCredit() : undefined
		)
		.ws('/', { message() {} })

	expectTypeOf<(typeof ws)['~Routes']>().toEqualTypeOf<
		(typeof wsBeforeHandle)['~Routes']
	>()
}

// On a WebSocket upgrade, a raw `Error` a `beforeHandle`, `derive` or
// `mapDerive` returns is dispatched like a thrown one, so it types in the
// route's response the same as on an HTTP route. The route has no `error`
// to keep what is left unhandled, so that is served as its problem document
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}
	class Lib extends Error {}

	const credit = ({ request }: { request: Request }) =>
		request.headers.has('x-credit') ? new OutOfCredit() : undefined
	const app = () => new Elysia().use(websocket())
	const message = { message() {} }

	type WS<App> = App extends {
		'~Routes': { ws: { subscribe: { response: infer Response } } }
	}
		? Response
		: never

	const unhandled = app().onBeforeHandle(credit).ws('/ws', message)
	const handledBefore = app()
		.onError(OutOfCredit, () => status(418, 'app' as const))
		.onBeforeHandle(credit)
		.ws('/ws', message)
	const handledAfterHook = app()
		.onBeforeHandle(credit)
		.onError(OutOfCredit, () => status(418, 'app' as const))
		.ws('/ws', message)
	const tooLate = app()
		.onBeforeHandle(credit)
		.ws('/ws', message)
		.onError(OutOfCredit, () => status(418, 'app' as const))

	expectTypeOf<keyof WS<typeof unhandled>>().toEqualTypeOf<402>()
	expectTypeOf<
		WS<typeof unhandled>[402]['type']
	>().toEqualTypeOf<'OUT_OF_CREDIT'>()
	expectTypeOf<WS<typeof handledBefore>>().toEqualTypeOf<{ 418: 'app' }>()
	expectTypeOf<WS<typeof handledAfterHook>>().toEqualTypeOf<{
		418: 'app'
	}>()
	expectTypeOf<keyof WS<typeof tooLate>>().toEqualTypeOf<402>()

	// Every source: the route's own `beforeHandle`, a guard's, a macro's, a
	// derive's, and a plain error as an unhandled 500
	const own = app().ws('/ws', { beforeHandle: credit, ...message })
	const ownStatus = app().ws('/ws', {
		beforeHandle: ({ request }) =>
			request.headers.has('x-deny')
				? status(401, 'no' as const)
				: undefined,
		...message
	})
	const guarded = app().guard({ beforeHandle: credit }).ws('/ws', message)
	const macro = app()
		.macro({ auth: { beforeHandle: credit } })
		.ws('/ws', { auth: true, ...message })
	const derived = app()
		.derive(({ request }) => {
			if (request.headers.has('x-credit')) return new OutOfCredit()

			return { user: 'saltyaom' }
		})
		.ws('/ws', message)
	const lib = app()
		.onBeforeHandle(({ request }) =>
			request.headers.has('x-lib') ? new Lib('x') : undefined
		)
		.ws('/ws', message)

	expectTypeOf<WS<typeof own>>().toEqualTypeOf<WS<typeof unhandled>>()
	expectTypeOf<WS<typeof ownStatus>>().toEqualTypeOf<{ 401: 'no' }>()
	expectTypeOf<WS<typeof guarded>>().toEqualTypeOf<WS<typeof unhandled>>()
	expectTypeOf<WS<typeof macro>>().toEqualTypeOf<WS<typeof unhandled>>()
	expectTypeOf<WS<typeof derived>>().toEqualTypeOf<WS<typeof unhandled>>()
	expectTypeOf<keyof WS<typeof lib>>().toEqualTypeOf<500>()

	// Across `.use()`, a parent's hook error resolves against the parent's
	// handlers registered before `.use()`
	const plugin = () => new Elysia().use(websocket()).ws('/ws', message)
	const parentHook = app().onBeforeHandle(credit).use(plugin())
	const parentHandles = app()
		.onError(OutOfCredit, () => status(418, 'parent' as const))
		.onBeforeHandle(credit)
		.use(plugin())

	expectTypeOf<WS<typeof parentHook>>().toEqualTypeOf<WS<typeof unhandled>>()
	expectTypeOf<WS<typeof parentHandles>>().toEqualTypeOf<{
		418: 'parent'
	}>()

	// Not typed exactly:
	// - the route's own `error` hook runs first on a WebSocket upgrade and
	//   answers (409), but a catch-all is typed as possibly passing the error
	//   on, so the class handler's answer (418) joins it
	// - a parent's handler registered before `.use()` takes over the
	//   plugin's own hook error at runtime (418), but a WebSocket route keeps
	//   no `error` for it to take over, so the plugin's 402 stays
	// - the plugin's own handler registered before its route catches the
	//   parent's hook error at runtime (418), but a route doesn't carry the
	//   handlers it was declared under
	const ownErrorHook = app()
		.onError(OutOfCredit, () => status(418, 'app' as const))
		.onBeforeHandle(credit)
		.ws('/ws', { error: () => status(409, 'local' as const), ...message })
	const takeover = app()
		.onError(OutOfCredit, () => status(418, 'parent' as const))
		.use(
			new Elysia()
				.use(websocket())
				.onBeforeHandle(credit)
				.ws('/ws', message)
		)
	const pluginHandles = app()
		.onBeforeHandle(credit)
		.use(
			new Elysia()
				.use(websocket())
				.onError(OutOfCredit, () => status(418, 'plugin' as const))
				.ws('/ws', message)
		)

	expectTypeOf<WS<typeof ownErrorHook>>().toEqualTypeOf<{
		409: 'local'
		418: 'app'
	}>()
	expectTypeOf<keyof WS<typeof takeover>>().toEqualTypeOf<402>()
	expectTypeOf<keyof WS<typeof pluginHandles>>().toEqualTypeOf<402>()
}
