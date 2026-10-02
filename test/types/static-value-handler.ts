import { Elysia, t } from '../../src'
import type { InlineHandlerNonMacro } from '../../src/types'

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
