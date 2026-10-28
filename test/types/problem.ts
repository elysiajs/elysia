/* eslint-disable @typescript-eslint/no-unused-vars */

import { Elysia, problem, t } from '../../src'

import { expectTypeOf } from 'expect-type'

// ? problem() is narrowed to the declared response schema
{
	const app = new Elysia().get(
		'/',
		{
			response: {
				409: t.Problem({ sku: t.Number() })
			}
		},
		({ problem }) => problem(409, { sku: 1 })
	)

	new Elysia().get(
		'/',
		{
			response: {
				409: t.Problem({ sku: t.Number() })
			}
		},
		({ problem }) =>
			// @ts-expect-error `sku` is a required extension member
			problem(409, {})
	)

	new Elysia().get(
		'/',
		{
			response: {
				409: t.Problem({ sku: t.Number() })
			}
		},
		({ problem }) =>
			// @ts-expect-error 404 is not a declared response status
			problem(404, {})
	)

	new Elysia().get(
		'/',
		{
			response: {
				409: t.Problem({ sku: t.Number() })
			}
		},
		({ problem }) =>
			// @ts-expect-error `extra` is not a member of the schema
			problem(409, { sku: 1, extra: 1 })
	)

	// A StatusMap name resolves to the same declared schema
	new Elysia().get(
		'/',
		{
			response: {
				409: t.Problem({ sku: t.Number() })
			}
		},
		({ problem }) => problem('Conflict', { sku: 1 })
	)

	type app = (typeof app)['~Routes']

	// `type`/`title`/`status` are always present, RFC 9457's optional members
	// stay optional, and the extension member is required
	expectTypeOf<app['get']['response'][409]>().toEqualTypeOf<{
		type: string
		code?: string
		title: string
		status: number
		detail?: string
		instance?: string
		sku: number
	}>()
}

// ? a required extension member makes the detail argument itself required
{
	new Elysia().get(
		'/',
		{
			response: {
				409: t.Problem({ sku: t.Number() })
			}
		},
		({ problem }) =>
			// @ts-expect-error `sku` is required, so `detail` cannot be omitted
			problem(409)
	)

	// ...but a schema whose every remaining member is optional keeps it optional
	new Elysia().get(
		'/',
		{
			response: {
				409: t.Problem()
			}
		},
		({ problem }) => problem(409)
	)
}

// ? a union response schema keeps every branch's own members
{
	const Problems = t.Union([
		t.Problem({ kind: t.Literal('a'), a: t.String() }),
		t.Problem({ kind: t.Literal('b'), b: t.String() })
	])

	new Elysia().get('/', { response: { 409: Problems } }, ({ problem }) =>
		problem(409, { kind: 'a', a: 'x' })
	)

	new Elysia().get('/', { response: { 409: Problems } }, ({ problem }) =>
		problem(409, { kind: 'b', b: 'x' })
	)

	new Elysia().get('/', { response: { 409: Problems } }, ({ problem }) =>
		// @ts-expect-error `b` belongs to the other branch
		problem(409, { kind: 'a', b: 'x' })
	)
}

// ? a non-object response schema has no problem shape to fill
{
	new Elysia().get('/', { response: { 409: t.String() } }, ({ problem }) =>
		// @ts-expect-error a string response is not a problem document
		problem(409, 'oops')
	)
}

// ? excess members are rejected even from a non-fresh object, because encode
// ? would silently strip them off the wire
{
	const detail = { sku: 1, extra: true }

	new Elysia().get(
		'/',
		{
			response: {
				409: t.Problem({ sku: t.Number() })
			}
		},
		({ problem }) =>
			// @ts-expect-error `extra` is not a member of the schema
			problem(409, detail)
	)
}

// ? without a response schema `problem` is the standalone function
{
	new Elysia().get('/', (context) => {
		expectTypeOf<(typeof context)['problem']>().toEqualTypeOf<
			typeof problem
		>()

		if (Math.random() > 0.5) return context.problem({ status: 418 })

		return context.problem(418, { detail: 'x' })
	})
}

// A status only known as `number` can be any status: the route may serve its
// body at a status it can't name, so it's keyed `default` (OpenAPI's "any
// other status", which Eden reads) beside the known ones, which stay typed.
// An empty status (204) is among them, so `undefined` too. Before, it added
// nothing, and Eden's error union claimed only the literal statuses
{
	const code = (): number => 418

	const app = new Elysia()
		.get('/handler', ({ status }) =>
			Math.random() ? status(code(), 'x' as const) : ('ok' as const)
		)
		.get('/problem', ({ problem }) =>
			Math.random() ? problem({ status: code() }) : ('ok' as const)
		)
		.get(
			'/mixed',
			{
				beforeHandle: ({ status }) =>
					Math.random() ? status(code(), 'x' as const) : undefined
			},
			({ status }) =>
				Math.random() ? status(401, 'no' as const) : ('ok' as const)
		)
		.macro({
			wide: {
				beforeHandle: ({ status }) =>
					Math.random() ? status(code(), 'x' as const) : undefined
			}
		})
		.get('/macro', { wide: true }, () => 'ok' as const)
		.onError(({ status }) => status(code(), 'e' as const))
		.get('/error', () => 'ok' as const)

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['handler']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		default: 'x' | undefined
	}>()
	expectTypeOf<keyof Routes['problem']['get']['response']>().toEqualTypeOf<
		200 | 'default'
	>()
	expectTypeOf<
		NonNullable<Routes['problem']['get']['response']['default']>['status']
	>().toEqualTypeOf<number>()
	expectTypeOf<Routes['mixed']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'no'
		default: 'x' | undefined
	}>()
	expectTypeOf<Routes['macro']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		default: 'x' | undefined
	}>()
	expectTypeOf<Routes['error']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		default: 'e' | undefined
	}>()
}

// A status is served with what the runtime sends, not what was passed: an
// empty status (204, 205, 304, 307, 308) has no body (`undefined`, as a
// handler's empty 200), and a nullish body becomes the status text
{
	const app = new Elysia()
		.get('/empty', ({ status }) =>
			Math.random()
				? status(204)
				: Math.random()
					? status(205, 'reset' as const)
					: status(307, { to: '/x' } as const)
		)
		.get('/nullish', ({ status }) =>
			status(404, Math.random() ? null : ('x' as const))
		)
		.get('/kept', ({ status }) =>
			Math.random() ? status(401) : status(201, 'made' as const)
		)

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['empty']['get']['response']>().toEqualTypeOf<{
		204: undefined
		205: undefined
		307: undefined
	}>()
	expectTypeOf<Routes['nullish']['get']['response']>().toEqualTypeOf<{
		404: 'x' | 'Not Found'
	}>()
	// unchanged
	expectTypeOf<Routes['kept']['get']['response']>().toEqualTypeOf<{
		201: 'made'
		401: 'Unauthorized'
	}>()
}

// One `status()` with a union code is served per status: a null body is
// "OK" at 200 but nothing at 204. And a nullish body at a status only known
// as `number` is the status text, or the code itself for an unnamed one
// (`status(599 as number, null)` sends 599)
{
	const app = new Elysia()
		.get('/union', ({ status }) => status(Math.random() ? 200 : 204, null))
		.get('/wide', ({ status }) => status(599 as number, null))

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['union']['get']['response']>().toEqualTypeOf<{
		200: 'OK'
		204: undefined
	}>()
	expectTypeOf<Routes['wide']['get']['response']>().toEqualTypeOf<{
		default: string | number | undefined
	}>()
}
