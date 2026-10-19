/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	Elysia,
	HTTPError,
	status,
	t,
	type ValidationErrorResponse
} from '../../src'

import { expectTypeOf } from 'expect-type'

// A route's own hook object runs on that route the same as `.guard()` and
// `.onBeforeHandle()` do, so what its hooks return is what the route can
// send: each status below is served at runtime by the matching hook

class Lib extends Error {}
class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

const ok = () => 'ok' as const

// beforeHandle, as a method, an arrow, and an array
{
	const method = new Elysia().get(
		'/',
		{
			beforeHandle() {
				if (Math.random()) return status(401, 'no')
			}
		},
		ok
	)
	const arrow = new Elysia().get(
		'/',
		{ beforeHandle: () => status(401, 'no') },
		ok
	)
	const array = new Elysia().get(
		'/',
		{
			beforeHandle: [
				() => (Math.random() ? status(401, 'no') : undefined),
				() => status(403, 'forbidden')
			]
		},
		ok
	)

	expectTypeOf<
		(typeof method)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
	}>()
	expectTypeOf<(typeof arrow)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
	}>()
	expectTypeOf<(typeof array)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
		403: 'forbidden'
	}>()
}

// A hook reading its context keeps the context typed and its return captured
{
	const app = new Elysia().get(
		'/',
		{
			query: t.Object({ x: t.Optional(t.String()) }),
			beforeHandle({ query }) {
				expectTypeOf(query.x).toEqualTypeOf<string | undefined>()

				if (!query.x) return status(401, 'no')
			}
		},
		ok
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
		422: ValidationErrorResponse
	}>()
}

// afterHandle
{
	const app = new Elysia().get(
		'/',
		{
			afterHandle() {
				if (Math.random()) return status(401, 'no')
			}
		},
		ok
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
	}>()
}

// A route's own error hook adds the statuses it answers with, the same as
// `.onError()` does for a `status()`
{
	const app = new Elysia().get(
		'/',
		{
			error() {
				return status(503, 'down')
			}
		},
		ok
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		503: 'down'
	}>()

	const route = new Elysia().get(
		'/',
		{
			error() {
				return status(503, 'down')
			}
		},
		() => new Lib('x')
	)
	const instance = new Elysia()
		.onError(() => status(503, 'down'))
		.get('/', () => new Lib('x'))

	expectTypeOf<(typeof route)['~Routes']['get']['response']>().toEqualTypeOf<
		(typeof instance)['~Routes']['get']['response']
	>()
}

// A plain value from an error hook is served at the error's own status (500,
// 422, ...), never as a success, so it doesn't join 200
{
	const plain = new Elysia().get(
		'/',
		{
			error() {
				return 'fallback' as const
			}
		},
		ok
	)

	expectTypeOf<(typeof plain)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
	}>()

	const mixed = new Elysia().get(
		'/',
		{
			error({ error }) {
				if (error instanceof Lib) return status(503, 'down')

				return 'fallback' as const
			}
		},
		ok
	)

	expectTypeOf<(typeof mixed)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		503: 'down'
	}>()
}

// A hook typed to return `unknown` adds nothing, and doesn't hide what another
// hook of the route answers with
{
	const crossPhase = new Elysia().get(
		'/',
		{
			beforeHandle: () => status(401, 'no'),
			afterHandle: ({ responseValue }) => responseValue
		},
		ok
	)

	expectTypeOf<
		(typeof crossPhase)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
	}>()

	const uncertain: () => unknown = () => undefined
	const array = new Elysia().get(
		'/',
		{ beforeHandle: [() => status(402, 'no'), uncertain] },
		ok
	)

	expectTypeOf<(typeof array)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		402: 'no'
	}>()
}

// Phases that answer with the same status take either body
{
	const app = new Elysia().get(
		'/',
		{
			beforeHandle() {
				if (Math.random()) return status(401, 'before')
			},
			error() {
				return status(401, 'error')
			}
		},
		ok
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'before' | 'error'
	}>()
}

// A hook that returns nothing adds nothing, and doesn't hide another phase
{
	const silent = new Elysia().get(
		'/',
		{
			beforeHandle() {
				console.log('seen')
			}
		},
		ok
	)

	expectTypeOf<
		(typeof silent)['~Routes']['get']['response']
	>().toEqualTypeOf<{
		200: 'ok'
	}>()

	const mixed = new Elysia().get(
		'/',
		{
			beforeHandle() {
				console.log('seen')
			},
			afterHandle() {
				if (Math.random()) return status(401, 'no')
			}
		},
		ok
	)

	expectTypeOf<(typeof mixed)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
	}>()
}

// The route's hook adds to a macro's on the same route
{
	const app = new Elysia()
		.macro({
			auth: {
				beforeHandle() {
					if (Math.random()) return status(402, 'macro')
				}
			}
		})
		.get(
			'/',
			{
				auth: true,
				beforeHandle() {
					if (Math.random()) return status(403, 'route')
				}
			},
			ok
		)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		402: 'macro'
		403: 'route'
	}>()
}

// Instance, guard and route hooks all apply to the route
{
	const app = new Elysia()
		.onBeforeHandle(() => {
			if (Math.random()) return status(401, 'instance')
		})
		.guard({
			beforeHandle() {
				if (Math.random()) return status(402, 'guard')
			}
		})
		.get(
			'/',
			{
				beforeHandle() {
					if (Math.random()) return status(403, 'route')
				}
			},
			ok
		)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'instance'
		402: 'guard'
		403: 'route'
	}>()
}

// Every method with a hook object
{
	const deny = { beforeHandle: () => status(401, 'no') }

	const app = new Elysia()
		.get('/', deny, ok)
		.post('/', deny, ok)
		.put('/', deny, ok)
		.patch('/', deny, ok)
		.delete('/', deny, ok)
		.options('/', deny, ok)
		.query('/', deny, ok)
		.head('/', deny, ok)
		.route('PURGE', '/', deny, ok)

	type Denied = { 200: 'ok'; 401: 'no' }
	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['get']['response']>().toEqualTypeOf<Denied>()
	expectTypeOf<Routes['post']['response']>().toEqualTypeOf<Denied>()
	expectTypeOf<Routes['put']['response']>().toEqualTypeOf<Denied>()
	expectTypeOf<Routes['patch']['response']>().toEqualTypeOf<Denied>()
	expectTypeOf<Routes['delete']['response']>().toEqualTypeOf<Denied>()
	expectTypeOf<Routes['options']['response']>().toEqualTypeOf<Denied>()
	expectTypeOf<Routes['query']['response']>().toEqualTypeOf<Denied>()
	expectTypeOf<Routes['head']['response']>().toEqualTypeOf<Denied>()
	expectTypeOf<Routes['PURGE']['response']>().toEqualTypeOf<Denied>()
}

// An `Error` a `beforeHandle` returns goes through `.onError(Class)` dispatch
// like one the handler returns, so the route types the same as that handler's:
// served under its own status (402) when nothing handles it
{
	const deny = () => (Math.random() ? new OutOfCredit() : undefined)
	const handler = new Elysia().get('/', () =>
		Math.random() ? new OutOfCredit() : ('ok' as const)
	)
	type Handler = (typeof handler)['~Routes']['get']

	const method = new Elysia().get(
		'/',
		{
			beforeHandle() {
				if (Math.random()) return new OutOfCredit()
			}
		},
		ok
	)
	const arrow = new Elysia().get('/', { beforeHandle: deny }, ok)
	const array = new Elysia().get(
		'/',
		{ beforeHandle: [() => undefined, deny] },
		ok
	)
	const async = new Elysia().get(
		'/',
		{
			async beforeHandle() {
				if (Math.random()) return new OutOfCredit()
			}
		},
		ok
	)

	expectTypeOf<(typeof method)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof arrow)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof array)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<(typeof async)['~Routes']['get']>().toEqualTypeOf<Handler>()
	expectTypeOf<
		(typeof arrow)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit>()

	// An `.onError(Class)` registered before the route answers instead,
	// registered after it doesn't apply
	const handled = new Elysia()
		.onError(OutOfCredit, () => status(418, 'teapot'))
		.get('/', { beforeHandle: deny }, ok)
	const handledByHandler = new Elysia()
		.onError(OutOfCredit, () => status(418, 'teapot'))
		.get('/', () => (Math.random() ? new OutOfCredit() : ('ok' as const)))

	expectTypeOf<(typeof handled)['~Routes']['get']>().toEqualTypeOf<
		(typeof handledByHandler)['~Routes']['get']
	>()
	expectTypeOf<
		(typeof handled)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 418: 'teapot' }>()

	const late = new Elysia()
		.get('/', { beforeHandle: deny }, ok)
		.onError(OutOfCredit, () => status(418, 'teapot'))

	expectTypeOf<(typeof late)['~Routes']['get']>().toEqualTypeOf<Handler>()

	// A parent's handler registered before `.use()` runs first, so it takes
	// the error over, even from the plugin's own handler
	const used = new Elysia()
		.onError(OutOfCredit, () => status(418, 'parent'))
		.use(new Elysia().get('/', { beforeHandle: deny }, ok))
	const takenOver = new Elysia()
		.onError(OutOfCredit, () => status(418, 'parent'))
		.use(
			new Elysia()
				.onError(OutOfCredit, () => status(403, 'plugin'))
				.get('/', { beforeHandle: deny }, ok)
		)

	expectTypeOf<(typeof used)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		418: 'parent'
	}>()
	expectTypeOf<
		(typeof takenOver)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 418: 'parent' }>()
}

// An `Error` from `afterHandle` goes through `.onError(Class)` dispatch too,
// so the route types the same as a handler returning it
{
	const handler = new Elysia().get('/', () =>
		Math.random() ? new OutOfCredit() : ('ok' as const)
	)
	const app = new Elysia().get(
		'/',
		{
			afterHandle() {
				if (Math.random()) return new OutOfCredit()
			}
		},
		ok
	)
	const instance = new Elysia()
		.onAfterHandle(() => {
			if (Math.random()) return new OutOfCredit()
		})
		.get('/', ok)

	expectTypeOf<(typeof app)['~Routes']['get']>().toEqualTypeOf<
		(typeof handler)['~Routes']['get']
	>()
	expectTypeOf<
		(typeof instance)['~Routes']['get']['response']
	>().toEqualTypeOf<(typeof handler)['~Routes']['get']['response']>()

	const handled = new Elysia()
		.onAfterHandle(() => {
			if (Math.random()) return new OutOfCredit()
		})
		.onError(OutOfCredit, () => status(418, 'teapot'))
		.get('/', ok)

	expectTypeOf<
		(typeof handled)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 418: 'teapot' }>()
}

// A hook object that names a schema, macro or lifecycle key is taken in whole
// to type the route, which turns off TypeScript's own excess property check:
// a misspelled key must still be reported, or a validator or macro silently
// doesn't run
{
	const app = new Elysia().macro({
		auth: {
			beforeHandle() {
				if (Math.random()) return status(401, 'no')
			}
		},
		role: (role: 'admin' | 'user') => ({ beforeHandle() {} }),
		withSchema: { query: t.Object({ q: t.String() }) },
		withDerive: { derive: () => ({ user: 1 }) },
		withMeta: { meta: { live: true }, beforeHandle() {} }
	})

	new Elysia().get(
		'/',
		{
			// @ts-expect-error `quer` is not `query`
			quer: t.Object({}),
			query: t.Object({})
		},
		ok
	)
	new Elysia().get(
		'/',
		{
			// @ts-expect-error `quer` is not `query`
			quer: t.Object({}),
			beforeHandle() {}
		},
		ok
	)
	new Elysia().get(
		'/',
		{
			// @ts-expect-error `quer` is not `query`
			quer: t.Object({}),
			beforeHandle: [() => {}]
		},
		ok
	)
	const base = { beforeHandle() {} }
	new Elysia().get(
		'/',
		{
			...base,
			// @ts-expect-error `quer` is not `query`
			quer: t.Object({})
		},
		ok
	)
	app.get(
		'/',
		{
			// @ts-expect-error `autth` is not the `auth` macro
			autth: true,
			beforeHandle() {}
		},
		ok
	)
	app.get(
		'/',
		{
			auth: true,
			// @ts-expect-error `autth` is not the `auth` macro
			autth: true
		},
		ok
	)
	app.get(
		'/',
		{
			// @ts-expect-error `autth` is not the `auth` macro
			autth: true,
			query: t.Object({})
		},
		ok
	)
	app.get(
		'/',
		{
			// @ts-expect-error `autth` is not the `auth` macro
			autth: true,
			withSchema: true
		},
		ok
	)
	app.post(
		'/',
		{
			// @ts-expect-error `autth` is not the `auth` macro
			autth: true,
			body: t.String()
		},
		ok
	)

	// A hoisted hook object is checked too, unlike a plain excess property
	const hoisted = { beforeHandle() {}, quer: 1 }
	// @ts-expect-error `quer` is not `query`
	new Elysia().get('/', hoisted, ok)

	// Every known key, macro and spread passes
	const valid = app.get(
		'/',
		{
			auth: true,
			role: 'admin',
			withSchema: true,
			withDerive: true,
			withMeta: true,
			query: t.Object({ a: t.String() }),
			detail: { summary: 'route' },
			tags: ['a'],
			beforeHandle({ query }) {
				expectTypeOf(query.a).toEqualTypeOf<string>()
			}
		},
		({ query }) => query.a
	)

	expectTypeOf<
		(typeof valid)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<string>()

	const asConst = {
		beforeHandle: () => status(401, 'no'),
		detail: { summary: 's' }
	} as const
	const spread = new Elysia().get(
		'/',
		{ ...base, ...asConst, query: t.Object({}) },
		ok
	)

	expectTypeOf<
		(typeof spread)['~Routes']['get']['response'][401]
	>().toEqualTypeOf<'no'>()
}

// `derive` and `trace` run on a route too, so they aren't typos
{
	new Elysia().get(
		'/',
		{ query: t.Object({ q: t.String() }), trace: [() => {}] },
		ok
	)
	new Elysia().get(
		'/',
		{ query: t.Object({}), derive: () => ({ user: 1 }) },
		ok
	)
	new Elysia().get(
		'/',
		{ beforeHandle() {}, derive: () => ({ user: 1 }) },
		ok
	)
}

// Keys the runtime ignores on a route are still typos: 1.x names and options
// that only mean something elsewhere
{
	new Elysia().get(
		'/',
		{
			query: t.Object({}),
			// @ts-expect-error 1.x name, `derive` in 2.0
			resolve: () => ({ user: 1 })
		},
		ok
	)
	new Elysia().post(
		'/',
		{
			body: t.String(),
			// @ts-expect-error 1.x name, `parse` in 2.0
			type: 'text'
		},
		ok
	)
	new Elysia().get(
		'/',
		{
			query: t.Object({}),
			// @ts-expect-error a `.guard()` option
			schema: 'merge'
		},
		ok
	)
}

// `.all()` takes the hook object in whole the same way
{
	new Elysia().all(
		'/',
		{
			query: t.Object({}),
			// @ts-expect-error `quer` is not `query`
			quer: t.Object({})
		},
		ok
	)
	new Elysia().all('/', { query: t.Object({}), detail: { summary: 's' } }, ok)
}
