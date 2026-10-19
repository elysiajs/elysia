import { Elysia, HTTPError, status, t } from '../../src'

import { expectTypeOf } from 'expect-type'

// A macro response schema constrains its consuming route's handler return.

const macro = new Elysia().macro({
	withId: {
		response: t.Object({ id: t.Number() })
	}
})

macro.get(
	'/obj',
	{ withId: true },
	// @ts-expect-error macro response { id: number } not satisfied by { name }
	() => ({ name: 'z' })
)

macro.get(
	'/num',
	{ withId: true },
	// @ts-expect-error number is not { id: number }
	() => 123
)

macro.get(
	'/sym',
	{ withId: true },
	// @ts-expect-error symbol is not { id: number }
	() => Symbol('x')
)
macro.get(
	'/big',
	{ withId: true },
	// @ts-expect-error bigint is not { id: number }
	() => 1n
)

macro.get(
	'/async',
	{ withId: true },
	// @ts-expect-error async wrong shape not satisfied
	async () => ({ name: 'z' })
)

// Primitive macro response schemas constrain handler returns too.
const macroStr = new Elysia().macro({ asStr: { response: t.String() } })
macroStr.get(
	'/str',
	{ asStr: true },
	// @ts-expect-error number where macro response string expected
	() => 123
)

// Valid direct, async, and status-wrapped values remain accepted.
macro.get('/ok', { withId: true }, () => ({ id: 1 }))
macro.get('/ok-async', { withId: true }, async () => ({ id: 1 }))
macro.get('/ok-status', { withId: true }, ({ status }) =>
	status(200, { id: 1 })
)

// Status-wrapped bodies must also satisfy the macro response schema.
macro.get('/status-wrong', { withId: true }, ({ status }) =>
	// @ts-expect-error status(200, { name }) violates macro response
	status(200, { name: 'z' })
)

// Eden routes retain the macro response's concrete body type.
const okApp = macro.get('/ok2', { withId: true }, () => ({ id: 1 }))
type IsAny<T> = 0 extends 1 & T ? true : false
type Ok2Body = (typeof okApp)['~Routes']['ok2']['get']['response'][200]
const _edenConcrete: IsAny<Ok2Body> = false

// Macro and instance-derived values remain typed in the handler context.
new Elysia()
	.derive(() => ({ traceId: 'x' as const }))
	.macro({ auth: { derive: () => ({ userId: 1 as const }) } })
	.get('/ctx', { auth: true }, (ctx) => {
		const _t: 'x' = ctx.traceId
		const _u: 1 = ctx.userId
		return { ok: true }
	})

// Route-local response schemas still constrain handlers without a macro.
new Elysia().get(
	'/nm-obj',
	{ response: t.Object({ id: t.Number() }) },
	// @ts-expect-error wrong object for the response schema
	() => ({ name: 'z' })
)

// Handlers without a response schema accept inferred values.
new Elysia().get('/nm-lit', () => 'lit')
new Elysia().get('/nm-obj-val', () => ({ a: 1 }))

// A matching route-local response remains accepted.
new Elysia().get(
	'/nm-val',
	{ response: t.Object({ name: t.String() }) },
	() => ({ name: 'a' })
)

// A macro's `beforeHandle` or `afterHandle` returning a raw `Error` goes back
// through `.onError(Class)` dispatch like the handler's own (402, or 418 once
// handled), so it types as an error, never under 200. Its `error` hook
// returning one serves it as an unhandled error at its own status, never
// dispatched again
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

	const credit = ({ request }: { request: Request }) =>
		request.headers.has('x-credit') ? new OutOfCredit() : undefined

	const auth = new Elysia().macro({ auth: { beforeHandle: credit } })

	const app = auth.get('/', { auth: true }, () => 'ok' as const)
	const handler = new Elysia().get('/', ({ request }) =>
		request.headers.has('x-credit') ? new OutOfCredit() : ('ok' as const)
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<
		(typeof handler)['~Routes']['get']['response']
	>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][200]
	>().toEqualTypeOf<'ok'>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit>()

	const handled = auth
		.onError(OutOfCredit, () => status(418, 'teapot' as const))
		.get('/', { auth: true }, () => 'ok' as const)

	expectTypeOf<
		(typeof handled)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: 'ok'; 418: 'teapot' }>()

	const after = new Elysia()
		.macro({ after: { afterHandle: credit } })
		.get('/', { after: true }, () => 'ok' as const)

	expectTypeOf<(typeof after)['~Routes']['get']['response']>().toEqualTypeOf<
		(typeof handler)['~Routes']['get']['response']
	>()

	// the `afterHandle` error reaches the `error` hook, whose own error is
	// served at its 402, not dispatched to the 418 handler
	class Lib extends Error {
		readonly lib = true
	}

	const failed = new Elysia()
		.macro({
			after: {
				afterHandle: () => (Math.random() ? new Lib() : undefined)
			},
			failed: { error: () => new OutOfCredit() }
		})
		.onError(OutOfCredit, () => status(418, 'teapot' as const))
		.get('/', { after: true, failed: true }, () => 'ok' as const)
	type Failed = (typeof failed)['~Routes']['get']['response']

	expectTypeOf<keyof Failed>().toEqualTypeOf<200 | 402>()
	expectTypeOf<Failed[402]['code']>().toEqualTypeOf<'OUT_OF_CREDIT'>()
}

// A macro's hooks each answer on their own, so a status two of them serve
// takes either body, beside a `beforeHandle`'s raw `Error`
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

	const app = new Elysia()
		.macro({
			auth: {
				beforeHandle: ({ request }: { request: Request }) =>
					request.headers.has('x-credit')
						? new OutOfCredit()
						: status(401, 'before' as const),
				afterHandle: () => status(401, 'after' as const),
				error: () => status(401, 'error' as const)
			}
		})
		.get('/', { auth: true }, () => 'ok' as const)

	type Route = (typeof app)['~Routes']['get']

	// its `error` hook always answers, so the raw `Error` never serves 402
	expectTypeOf<keyof Route['response']>().toEqualTypeOf<200 | 401>()
	expectTypeOf<Route['response'][401]>().toEqualTypeOf<
		'before' | 'after' | 'error'
	>()
	expectTypeOf<Route['error']>().toEqualTypeOf<never>()
}
