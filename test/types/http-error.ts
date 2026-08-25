/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, HTTPError, problem, status } from '../../src'
import type { TaggedHTTPError } from '../../src'
import type { ElysiaStatus } from '../../src/error'
import type { StatusMap } from '../../src/constants'

import { expectTypeOf } from 'expect-type'

// A self-describing error maps to the RFC 9457 problem document it actually
// serves, at its own status, without `.error()`.

class OutOfCredit extends HTTPError<'OUT_OF_CREDIT'> {
	type = 'OUT_OF_CREDIT' as const
	override readonly status = 402

	detail() {
		return 'Out of credit'
	}
}

class Deferred extends HTTPError<'DEFERRED'> {
	type = 'DEFERRED' as const
	override readonly status = 409

	async detail() {
		return { deferred: true }
	}
}

// An annotated error infers its own status, not an unhandled 500, and the
// entry is the full problem envelope rather than the raw value.
{
	const app = new Elysia().get('/', () =>
		Math.random() > 0.5 ? new OutOfCredit() : ('ok' as const)
	)

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<200 | 402>()
	expectTypeOf<Response[200]>().toEqualTypeOf<'ok'>()

	// the one full spot-assert: envelope members, annotated body, and the
	// `instance` member the envelope keeps optional
	expectTypeOf<Response[402]>().toMatchTypeOf<{
		type: 'OUT_OF_CREDIT'
		title: string
		detail: string
		status: 402
	}>()
	expectTypeOf<Response[402]['type']>().toEqualTypeOf<'OUT_OF_CREDIT'>()
	expectTypeOf<Response[402]['status']>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]['detail']>().toEqualTypeOf<string>()
	expectTypeOf<Response[402]['title']>().toEqualTypeOf<string>()
	expectTypeOf<Response[402]['instance']>().toEqualTypeOf<
		string | undefined
	>()
}

// A promised `detail` is awaited, then carried verbatim.
{
	const app = new Elysia().get('/', () => new Deferred())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<409>()
	expectTypeOf<Response[409]>().toMatchTypeOf<{
		type: 'DEFERRED'
		detail: { deferred: boolean }
		status: 409
	}>()
}

// Each annotated error keeps its own status and its own problem type.
{
	const app = new Elysia().get('/', () =>
		Math.random() > 0.5 ? new OutOfCredit() : new Deferred()
	)

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402 | 409>()
	expectTypeOf<Response[402]['type']>().toEqualTypeOf<'OUT_OF_CREDIT'>()
	expectTypeOf<Response[409]['type']>().toEqualTypeOf<'DEFERRED'>()
}

// Registering a handler replaces the self-described response.
{
	const app = new Elysia()
		.get('/', () => new OutOfCredit())
		.error(OutOfCredit, () => status(409, 'handled' as const))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		409: 'handled'
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()
}

// An explicit response sharing the error's status survives the replacement.
{
	const app = new Elysia()
		.get('/', () =>
			Math.random() > 0.5 ? new OutOfCredit() : status(402, 'explicit')
		)
		.error(OutOfCredit, () => status(409, 'handled' as const))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		402: 'explicit'
		409: 'handled'
	}>()
}

// A handler falling through lands on the same lane, so it serves the same
// problem document.
{
	const app = new Elysia()
		.get('/', () => new OutOfCredit())
		.error(OutOfCredit, () => undefined)

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]>().toMatchTypeOf<{
		type: 'OUT_OF_CREDIT'
		detail: string
		status: 402
	}>()
}

// A `detail` that may resolve `undefined` falls through to the message, so
// both arms appear — the annotated value on one, the message string on the
// other, each inside a problem document.
{
	class Maybe extends HTTPError<'MAYBE'> {
		type = 'MAYBE' as const
		override readonly status = 404

		detail(): { payload: string } | undefined {
			return Math.random() > 0.5 ? { payload: 'maybe' } : undefined
		}
	}

	const app = new Elysia().get('/', () => new Maybe())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<404>()
	expectTypeOf<Response[404]['detail']>().toEqualTypeOf<
		{ payload: string } | string
	>()
	expectTypeOf<Response[404]['type']>().toEqualTypeOf<'MAYBE'>()
}

// A value-shaped foreign error is not self-describing: the runtime needs a
// literal `type` or a status before it serves an annotation.
{
	class SDKError extends Error {
		readonly value = { detail: 'sdk' }
	}

	const app = new Elysia().get('/', () => new SDKError())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		500: SDKError
	}>()
}

// A wide-string `type` (ErrorEvent, SDK errors) is not a problem claim.
{
	class Wild extends Error {
		type = 'error'
		readonly value = { detail: 'wild' }
	}

	const app = new Elysia().get('/', () => new Wild())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		500: Wild
	}>()
}

// A literal status opts a foreign error into the contract. Its eagerly
// assigned value is inert data, and `value` overrides the whole response, so
// the entry is raw.
{
	class Implemented extends Error {
		readonly status = 403 as const
		readonly value = { detail: 'forbidden' }
	}

	const app = new Elysia().get('/', () => new Implemented())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: { detail: string }
	}>()
}

// A *value* `detail` on the same shape is enveloped instead, under the
// default problem type.
{
	class Implemented extends Error {
		readonly status = 403 as const
		readonly detail = { why: 'forbidden' }
	}

	const app = new Elysia().get('/', () => new Implemented())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<403>()
	expectTypeOf<Response[403]['type']>().toEqualTypeOf<'about:blank'>()
	expectTypeOf<Response[403]['detail']>().toEqualTypeOf<{ why: string }>()
}

// A *function* annotation on an unclaimed duck error is never invoked, so it
// annotates nothing and the raw message entry stands.
{
	class ForeignFn extends Error {
		readonly status = 403 as const

		detail() {
			return { never: 'run' }
		}
	}

	const app = new Elysia().get('/', () => new ForeignFn())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: string
	}>()
}

// A value-less foreign duck error never claimed a problem document, it keeps
// its raw message entry.
{
	class ForeignBare extends Error {
		readonly status = 403 as const
	}

	const app = new Elysia().get('/', () => new ForeignBare())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		403: string
	}>()
}

// `HTTPError.id` carries a literal `type` and makes no status claim.
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT') {}

	const app = new Elysia().get('/', () => new OutOfCredit())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<500>()
	expectTypeOf<Response[500]>().toMatchTypeOf<{
		type: 'OUT_OF_CREDIT'
		detail: string
		status: 500
	}>()
	expectTypeOf(new OutOfCredit().type).toEqualTypeOf<'OUT_OF_CREDIT'>()
	expectTypeOf(new OutOfCredit().status).toEqualTypeOf<
		number | keyof StatusMap | undefined
	>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit>()
}

// An `HTTPError.id` subclass annotating a status serves it.
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT') {
		override readonly status = 402

		detail() {
			return { remaining: 0 }
		}
	}

	const app = new Elysia().get('/', () => new OutOfCredit())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]>().toMatchTypeOf<{
		type: 'OUT_OF_CREDIT'
		detail: { remaining: number }
		status: 402
	}>()
}

// `HTTPError.id`'s second argument annotates a numeric status on the returned class,
// no class-body override needed.
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {
		detail() {
			return { remaining: 0 }
		}
	}

	const app = new Elysia().get('/', () => new OutOfCredit())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]>().toMatchTypeOf<{
		type: 'OUT_OF_CREDIT'
		detail: { remaining: number }
		status: 402
	}>()
	expectTypeOf(new OutOfCredit().status).toEqualTypeOf<402>()
}

// `HTTPError.id`'s second argument accepts a status name and resolves it to the same
// numeric literal, both on the class annotation and the response key.
{
	class Denied extends HTTPError.id('DENIED', 'Payment Required') {
		detail() {
			return 'denied'
		}
	}

	const app = new Elysia().get('/', () => new Denied())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]['status']>().toEqualTypeOf<402>()
	expectTypeOf(new Denied().status).toEqualTypeOf<402>()
}

// The `status` property accepts a name and infers its numeric literal key.
{
	class Denied extends HTTPError<'DENIED'> {
		type = 'DENIED' as const
		override readonly status = 'Payment Required'

		detail() {
			return 'denied'
		}
	}

	const app = new Elysia().get('/', () => new Denied())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]['status']>().toEqualTypeOf<402>()
}

// `value` replaces the whole response, so the entry is exactly what it
// returns — no envelope members at all.
{
	class Legacy extends HTTPError<'LEGACY'> {
		type = 'LEGACY' as const
		override readonly status = 409

		value() {
			return { code: 'LEGACY' as const, ok: false }
		}
	}

	const app = new Elysia().get('/', () => new Legacy())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		409: { code: 'LEGACY'; ok: boolean }
	}>()
}

// `value` wins over `detail` when both are annotated.
{
	class Both extends HTTPError.id('BOTH', 402) {
		value() {
			return { winner: 'value' as const }
		}

		detail() {
			return 'loser'
		}
	}

	const app = new Elysia().get('/', () => new Both())

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		402: { winner: 'value' }
	}>()
}

// A `value` that may resolve `undefined` falls through, so both tiers appear.
{
	class Falls extends HTTPError.id('FALLS', 402) {
		value(): { raw: true } | undefined {
			return Math.random() > 0.5 ? { raw: true } : undefined
		}

		detail() {
			return 'fell through'
		}
	}

	const app = new Elysia().get('/', () => new Falls())

	type Entry = (typeof app)['~Routes']['get']['response'][402]

	expectTypeOf<Extract<Entry, { raw: true }>>().toEqualTypeOf<{ raw: true }>()
	expectTypeOf<
		Extract<Entry, { type: 'FALLS' }>['detail']
	>().toEqualTypeOf<string>()
}

// An error without a literal status falls back to 500, still problem-shaped.
{
	class Vague extends HTTPError<'VAGUE'> {
		type = 'VAGUE' as const

		detail() {
			return { vague: true }
		}
	}

	const app = new Elysia().get('/', () => new Vague())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<500>()
	expectTypeOf<Response[500]>().toMatchTypeOf<{
		type: 'VAGUE'
		detail: { vague: boolean }
		status: 500
	}>()
}

// Both knobs are declared *optional* on the base, so `implements` type-checks
// with only `type` supplied — and naming a `type` is itself the problem claim.
{
	class ImplNoValue extends Error implements HTTPError<'IMPL_NO_VALUE'> {
		type = 'IMPL_NO_VALUE' as const
		readonly status = 403
	}

	const app = new Elysia().get('/', () => new ImplNoValue())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<403>()
	expectTypeOf<Response[403]>().toMatchTypeOf<{
		type: 'IMPL_NO_VALUE'
		detail: string
		status: 403
	}>()
}

// `implements` checks assignability, not member kind, so a method satisfies
// the declared knob. A plain value no longer does.
{
	class ImplMethod extends Error implements HTTPError<'IMPL_METHOD'> {
		type = 'IMPL_METHOD' as const
		readonly status = 403

		detail() {
			return 'forbidden by policy'
		}
	}

	class ImplValue extends Error implements HTTPError<'IMPL_VALUE'> {
		type = 'IMPL_VALUE' as const
		readonly status = 403

		// @ts-expect-error a knob is a method, not a value
		detail = 'forbidden by policy'
	}

	const app = new Elysia().get('/', () => new ImplMethod())

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][403]['detail']
	>().toEqualTypeOf<string>()
}

// A registered handler's `problem()` keeps a wide `type` at the type level.
// The runtime narrows it to the intercepted error's tag, which `string` still
// describes truthfully — threading the literal through the registered-handler
// response machinery is left undone deliberately.
{
	class Denied extends HTTPError.id('DENIED', 400) {}

	const app = new Elysia()
		.error(Denied, () => problem(400, { detail: 'q' }))
		.get('/', () => new Denied())

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][400]['type']
	>().toEqualTypeOf<string>()
}

// The base declares both knobs as methods, so a method is the only form an
// owned class can annotate them with — an eagerly assigned value is rejected.
{
	class EagerDetail extends HTTPError.id('EAGER_DETAIL', 410) {
		// @ts-expect-error a knob is a method, not a value
		detail = 'known upfront'
	}

	class EagerValue extends HTTPError.id('EAGER_VALUE', 410) {
		// @ts-expect-error a knob is a method, not a value
		value = { eager: true }
	}

	// An accessor reads as its value, so it is rejected for the same reason
	class DynamicValue extends HTTPError.id('DYNAMIC_VALUE', 410) {
		// @ts-expect-error a knob is a method, not an accessor
		get value() {
			return { dynamic: true }
		}
	}
}

// Either knob declared to return `unknown` annotates nothing — the message
// fallback is served instead.
{
	class OpaqueValue extends HTTPError.id('OPAQUE_VALUE', 409) {
		value(): unknown {
			return { whatever: true }
		}
	}

	class OpaqueDetail extends HTTPError.id('OPAQUE_DETAIL', 409) {
		detail(): unknown {
			return { whatever: true }
		}
	}

	const app = new Elysia()
		.get('/value', () => new OpaqueValue())
		.get('/detail', () => new OpaqueDetail())

	expectTypeOf<
		(typeof app)['~Routes']['value']['get']['response'][409]['detail']
	>().toEqualTypeOf<string>()
	expectTypeOf<
		(typeof app)['~Routes']['detail']['get']['response'][409]['detail']
	>().toEqualTypeOf<string>()
}

// `value()` may hand back a `status()` or `problem()`, which is served at the
// status *it* carries — so it escapes to its own response key instead of
// being trapped under the annotated one.
{
	class Flaky extends HTTPError.id('FLAKY', 402) {
		value() {
			return problem(503, { detail: 'downstream dead' })
		}
	}

	const app = new Elysia().get('/', () => new Flaky())

	type Response = (typeof app)['~Routes']['get']['response']

	// the annotated 402 never happens: every serve goes out as 503
	expectTypeOf<keyof Response>().toEqualTypeOf<503>()
	expectTypeOf<Response[503]>().toMatchTypeOf<{
		type: string
		title: string
		detail: 'downstream dead'
		status: 503
	}>()
}

// An async `status()` return escapes the same way, carrying its raw value.
{
	class Made extends HTTPError.id('MADE', 402) {
		async value() {
			return status(201, { made: 'it' as const })
		}
	}

	const app = new Elysia().get('/', () => new Made())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<201>()
	// `status()` takes a `const` type parameter, so the literal comes back readonly
	expectTypeOf<Response[201]>().toEqualTypeOf<{ readonly made: 'it' }>()
}

// A mixed union composes all three tiers: the escaped status, the plain value
// under the annotated status, and the `detail` fall-through beside it.
{
	class Mixed extends HTTPError.id('MIXED', 402) {
		value(): ElysiaStatus<503, { esc: true }> | { plain: true } | undefined {
			return undefined
		}

		detail() {
			return 'fell through'
		}
	}

	const app = new Elysia().get('/', () => new Mixed())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402 | 503>()
	expectTypeOf<Response[503]>().toEqualTypeOf<{ esc: true }>()
	expectTypeOf<Extract<Response[402], { plain: true }>>().toEqualTypeOf<{
		plain: true
	}>()
	expectTypeOf<
		Extract<Response[402], { type: 'MIXED' }>['detail']
	>().toEqualTypeOf<string>()
}

// A handler that falls through inherits the escape too.
{
	class Flaky extends HTTPError.id('FLAKY', 402) {
		value() {
			return problem(503, { detail: 'downstream dead' })
		}
	}

	const app = new Elysia()
		.get('/', () => new Flaky())
		.error(Flaky, () => undefined)

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<503>()
	expectTypeOf<Response[503]['status']>().toEqualTypeOf<503>()
}

// Registering a real handler still reshapes away the escaped entry.
{
	class Flaky extends HTTPError.id('FLAKY', 402) {
		value() {
			return problem(503, { detail: 'downstream dead' })
		}
	}

	const app = new Elysia()
		.get('/', () => new Flaky())
		.error(Flaky, () => status(409, 'handled' as const))

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		409: 'handled'
	}>()
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<never>()
}

// A bare `Error` among the returns adds its own unhandled 500 bucket without
// disturbing the entries its registered siblings contributed.
//
// The handler's return type must be annotated. TypeScript applies union
// *subtype reduction* when it infers a return type from several `return`
// statements, and every custom error class is a subtype of `Error` — so an
// un-annotated `() => { return new Error1(); return new Error() }` infers
// plain `Error | …`, with `Error1` absorbed before Elysia sees it. The
// absorption is pinned below.
{
	class Error1 extends HTTPError.id('error1') {}
	class Error2 extends HTTPError.id('error2') {
		value() {
			return problem(418, { detail: 'a' })
		}
	}

	const app = new Elysia()
		.error(Error1, problem(400, { detail: 'q' }))
		.error(Error2, problem(401, { detail: 'q' }))
		.get('/', (): Error1 | Error2 | Error | 'ok' => {
			if (Math.random() > 0.25) return new Error1()
			if (Math.random() > 0.25) return new Error2()
			if (Math.random() > 0.25) return new Error()
			return 'ok'
		})

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<200 | 400 | 401 | 500>()
	expectTypeOf<Response[200]>().toEqualTypeOf<'ok'>()
	expectTypeOf<Response[400]>().toMatchTypeOf<{ status: 400 }>()
	expectTypeOf<Response[401]>().toMatchTypeOf<{ status: 401 }>()
	expectTypeOf<Response[500]>().toEqualTypeOf<Error>()
	// the handler intercepts Error2 before `value()` runs, so no 418
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<Error>()
}

// The same holds for the function registration form.
{
	class Error1 extends HTTPError.id('error1') {}

	const app = new Elysia()
		.error(Error1, () => problem(400, { detail: 'q' }))
		.get('/', (): Error1 | Error | 'ok' => {
			if (Math.random() > 0.5) return new Error1()
			if (Math.random() > 0.5) return new Error()
			return 'ok'
		})

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<200 | 400 | 500>()
	expectTypeOf<Response[500]>().toEqualTypeOf<Error>()
}

// Control: a bare `Error` on its own still gets its 500 bucket.
{
	const app = new Elysia().get('/', (): Error | 'ok' =>
		Math.random() > 0.5 ? new Error() : 'ok'
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		500: Error
	}>()
}

// A bare `Error` beside an *unregistered* self-described class: the
// self-described entry keeps its own status, the bare one keeps 500.
{
	class Denied extends HTTPError.id('denied', 402) {
		detail() {
			return 'no funds'
		}
	}

	const app = new Elysia().get('/', (): Denied | Error | 'ok' => {
		if (Math.random() > 0.5) return new Denied()
		if (Math.random() > 0.5) return new Error()
		return 'ok'
	})

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<200 | 402 | 500>()
	expectTypeOf<Response[402]['type']>().toEqualTypeOf<'denied'>()
	expectTypeOf<Response[500]>().toEqualTypeOf<Error>()
}

// And beside one whose `value()` escapes to a different status.
{
	class Flaky extends HTTPError.id('flaky', 402) {
		value() {
			return problem(503, { detail: 'downstream dead' })
		}
	}

	const app = new Elysia().get('/', (): Flaky | Error | 'ok' => {
		if (Math.random() > 0.5) return new Flaky()
		if (Math.random() > 0.5) return new Error()
		return 'ok'
	})

	expectTypeOf<
		keyof (typeof app)['~Routes']['get']['response']
	>().toEqualTypeOf<200 | 500 | 503>()
}

// Pin for the TypeScript limitation above: without the annotation, subtype
// reduction absorbs the subclass into the bare `Error` member, so `Error1` is
// already gone from the handler's inferred return type — before any Elysia
// type runs. If TypeScript ever stops reducing here, this flips and the
// annotation requirement can be dropped from the docs.
{
	class Error1 extends HTTPError.id('error1') {}

	const handler = () => {
		if (Math.random() > 0.5) return new Error1()
		if (Math.random() > 0.5) return new Error()
		return 'ok' as const
	}

	expectTypeOf<
		[Extract<ReturnType<typeof handler>, Error1>] extends [never]
			? 'absorbed'
			: 'present'
	>().toEqualTypeOf<'absorbed'>()
}

// `HTTPError` states the contract, it never serves as an error itself — the
// `type` that discriminates one class from another is the subclass's to name.
{
	// @ts-expect-error HTTPError is abstract, subclass it or use `HTTPError.id`
	new HTTPError()
}

// What `HTTPError.id` hands back is concrete, and keeps `Error`'s own constructor, so
// a message and a cause pass through.
{
	class Denied extends HTTPError.id('DENIED', 402) {}

	expectTypeOf(new Denied()).toMatchTypeOf<Error>()
	expectTypeOf(new Denied('no funds')).toMatchTypeOf<Error>()
	expectTypeOf(
		new Denied('no funds', { cause: new Error('upstream') })
	).toMatchTypeOf<Error>()
	expectTypeOf(new Denied().type).toEqualTypeOf<'DENIED'>()
}

// `TaggedHTTPError` names that class, so one can be held in an annotated
// binding and still construct to its tagged instance.
{
	const Denied: TaggedHTTPError<'DENIED'> = HTTPError.id('DENIED')

	expectTypeOf(new Denied().type).toEqualTypeOf<'DENIED'>()
	expectTypeOf(new Denied('no funds')).toMatchTypeOf<Error>()
}

// `headers` annotates the wire, not the document — it rides along on the
// response without joining the body the error describes.
{
	class Denied extends HTTPError.id('DENIED', 402) {
		override readonly headers = { 'x-reason': 'no-funds' }

		detail() {
			return 'no funds'
		}
	}

	const app = new Elysia().get('/', () => new Denied())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]>().toMatchTypeOf<{
		type: 'DENIED'
		detail: string
		status: 402
	}>()
	expectTypeOf<Response[402]>().not.toHaveProperty('headers')
}
