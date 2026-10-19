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
