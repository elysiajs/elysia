import { Elysia, t } from '../../src'
import type { InlineHandlerNonMacro } from '../../src/types'

import { expectTypeOf } from 'expect-type'

// A handler may be a static value instead of a function. Without a response
// schema anything inline-able is accepted; with one, the value must satisfy
// the schema exactly like a function's return value would.

new Elysia()
	.post('/free', 'anything')
	.post('/free-number', 1)
	.post('/free-promise', Promise.resolve({ a: 1 }))
	.post('/typed', { response: t.String() }, 'ok')
	.post('/typed-promise', { response: t.String() }, Promise.resolve('ok'))
	.post(
		'/typed-status',
		{ response: { 200: t.String(), 404: t.Object({ e: t.String() }) } },
		'ok'
	)
	// @ts-expect-error a static value is checked against the response schema
	.post('/wrong', { response: t.String() }, 1)
	// @ts-expect-error a promised static value is checked too
	.post('/wrong-promise', { response: t.String() }, Promise.resolve(1))
	// @ts-expect-error a static value must match one of the declared statuses
	.post('/wrong-status', { response: { 200: t.String() } }, { e: 'x' })

// Response maps produced by a schema always have required status keys, so an
// optional key never authorises a bare `undefined` value handler. This pins
// the constraint's `infer` capture (kept for type-check performance) to that
// contract.
declare const optionalKey: undefined
// @ts-expect-error optional status keys do not admit undefined
optionalKey satisfies InlineHandlerNonMacro<{ response: { 200?: string } }>

// A `t.Any()` / `t.Unknown()` status widens the accepted static value to
// anything, but that must not cost a function handler its context: an `any`
// member would swallow the handler's own signature, leaving `query` untyped
{
	const query = t.Object({ x: t.Optional(t.String()) })

	const app = new Elysia()
		.get(
			'/any',
			{ query, response: { 200: t.String(), 402: t.Any() } },
			({ query }) => {
				expectTypeOf(query).toEqualTypeOf<{ x?: string }>()

				return 'ok'
			}
		)
		.get(
			'/unknown',
			{ query, response: { 200: t.String(), 402: t.Unknown() } },
			(ctx) => {
				expectTypeOf(ctx.query).toEqualTypeOf<{ x?: string }>()

				return 'ok'
			}
		)
		.get('/whole', { query, response: t.Any() }, ({ query }) => {
			expectTypeOf(query).toEqualTypeOf<{ x?: string }>()

			return 'ok'
		})

	new Elysia()
		.macro({ loose: { response: { 200: t.String(), 402: t.Any() } } })
		.get('/macro', { query, loose: true }, ({ query }) => {
			expectTypeOf(query).toEqualTypeOf<{ x?: string }>()

			return 'ok'
		})

	// The declared status keeps its schema's type for Eden
	type Response = (typeof app)['~Routes']['any']['get']['response']
	expectTypeOf<Response[402]>().toBeAny()
	expectTypeOf<Response[200]>().toEqualTypeOf<string>()

	// Static values `t.Any()` accepts stay accepted, `InlineResponse` would
	// reject all of these
	new Elysia()
		.get('/null', { response: { 200: t.String(), 402: t.Any() } }, null)
		.get('/array', { response: t.Any() }, [1, 2])
		.get('/date', { response: t.Unknown() }, new Date())
		.get('/bigint', { response: t.Any() }, 1n)
}
