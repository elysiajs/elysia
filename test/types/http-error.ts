/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, HTTPError, problem, status, t } from '../../src'
import type { TaggedHTTPError } from '../../src'
import type { ElysiaStatus } from '../../src/error'
import type { StatusMap } from '../../src/constants'

import { expectTypeOf } from 'expect-type'

// A self-describing error maps to the RFC 9457 problem document it actually
// serves, at its own status, without `.onError()`.

class OutOfCredit extends HTTPError<'OUT_OF_CREDIT'> {
	type = 'OUT_OF_CREDIT' as const
	override readonly status = 402
	override readonly detail = 'Out of credit'
}

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

class Deferred extends HTTPError<'DEFERRED'> {
	type = 'DEFERRED' as const
	override readonly status = 409

	async value() {
		return problem(409, { type: 'DEFERRED', deferred: true })
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
	// a readonly `detail` keeps its literal, as `status` does
	expectTypeOf<Response[402]['detail']>().toEqualTypeOf<'Out of credit'>()
	expectTypeOf<Response[402]['title']>().toEqualTypeOf<string>()
	expectTypeOf<Response[402]['instance']>().toEqualTypeOf<
		string | undefined
	>()
}

// A promised `value` is awaited, and the `problem()` it resolves keeps the
// problem shape, structured data riding as extension members.
{
	const app = new Elysia().get('/', () => new Deferred())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<409>()
	expectTypeOf<Response[409]>().toMatchTypeOf<{
		type: 'DEFERRED'
		deferred: true
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
		.onError(OutOfCredit, () => status(409, 'handled' as const))
		.get('/', () => new OutOfCredit())

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
		.onError(OutOfCredit, () => status(409, 'handled' as const))
		.get('/', () =>
			Math.random() > 0.5 ? new OutOfCredit() : status(402, 'explicit')
		)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		402: 'explicit'
		409: 'handled'
	}>()
}

// A handler falling through lands on the same lane, so it serves the same
// problem document.
{
	const app = new Elysia()
		.onError(OutOfCredit, () => undefined)
		.get('/', () => new OutOfCredit())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]>().toMatchTypeOf<{
		type: 'OUT_OF_CREDIT'
		detail: string
		status: 402
	}>()
}

// A `detail` that may be `undefined` falls through to the message, so both
// arms appear — the annotated string on one, the message (absent when none
// was given) on the other, each inside a problem document.
{
	class Maybe extends HTTPError<'MAYBE'> {
		type = 'MAYBE' as const
		override readonly status = 404
		override readonly detail =
			Math.random() > 0.5 ? ('maybe' as const) : undefined
	}

	const app = new Elysia().get('/', () => new Maybe())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<404>()
	// the annotated arm, its `detail` required
	expectTypeOf<
		Extract<Response[404], { detail: 'maybe' }>['detail']
	>().toEqualTypeOf<'maybe'>()
	// the message arm beside it
	expectTypeOf<Response[404]['detail']>().toEqualTypeOf<string | undefined>()
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
		500: Unhandled500
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
		500: Unhandled500
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

// A function `detail` is never invoked even once a problem is claimed, owned
// or not: it annotates nothing, so the message is the `detail` served. The
// method form is gone from `HTTPError`, declaring it is a type error.
{
	class ClaimedFn extends Error {
		type = 'CLAIMED_FN' as const
		readonly status = 403 as const

		detail() {
			return { never: 'run' }
		}
	}

	class OwnedFn extends HTTPError.id('OWNED_FN', 403) {
		// @ts-expect-error `detail` is a string, not a method
		detail() {
			return { never: 'run' }
		}
	}

	const app = new Elysia()
		.get('/claimed', () => new ClaimedFn())
		.get('/owned', () => new OwnedFn())

	expectTypeOf<
		(typeof app)['~Routes']['claimed']['get']['response'][403]['detail']
	>().toEqualTypeOf<string | undefined>()
	expectTypeOf<
		(typeof app)['~Routes']['claimed']['get']['response'][403]['type']
	>().toEqualTypeOf<'CLAIMED_FN'>()
	expectTypeOf<
		(typeof app)['~Routes']['owned']['get']['response'][403]['detail']
	>().toEqualTypeOf<string | undefined>()
}

// The same holds for a function member of a mixed `detail`: never invoked, so
// what it returns never reaches the type, and the message arm stands beside
// the data member.
{
	class Mixed extends Error {
		type = 'MIXED_DETAIL' as const
		readonly status = 409 as const
		readonly detail: 'literal' | (() => { phantom: true }) = 'literal'
	}

	const app = new Elysia().get('/', () => new Mixed())

	type Entry = (typeof app)['~Routes']['get']['response'][409]

	// the data arm
	expectTypeOf<
		Extract<Entry, { detail: 'literal' }>['detail']
	>().toEqualTypeOf<'literal'>()
	// the message arm, and no `{ phantom: true }` anywhere
	expectTypeOf<Entry['detail']>().toEqualTypeOf<string | undefined>()
}

// A promised `detail` is plain data too: never awaited, so the document
// carries the Promise as it was annotated, never what it resolves to — the
// runtime serializes it untouched (`{}`), and no other tier models
// serialization either. Holding neither `undefined` nor a function, it has
// no message arm.
{
	class Pending extends Error {
		type = 'PENDING' as const
		readonly status = 409 as const
		readonly detail = Promise.resolve({ resolved: true })
	}

	const app = new Elysia().get('/', () => new Pending())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<409>()
	expectTypeOf<Response[409]['detail']>().toEqualTypeOf<
		Promise<{ resolved: boolean }>
	>()
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
		detail?: string
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

// With nothing annotated `detail` is the message, which a type can't see was
// given: `new OutOfCredit()` serves no `detail` member at all, so it's optional.
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

	const app = new Elysia().get('/', () => new OutOfCredit())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<Response[402]['detail']>().toEqualTypeOf<string | undefined>()
	expectTypeOf<{
		type: 'OUT_OF_CREDIT'
		code: 'OUT_OF_CREDIT'
		title: string
		status: 402
	}>().toMatchTypeOf<Response[402]>()
}

// An `HTTPError.id` subclass annotating a status serves it.
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT') {
		override readonly status = 402
		override readonly detail = 'No credit remaining'
	}

	const app = new Elysia().get('/', () => new OutOfCredit())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]>().toMatchTypeOf<{
		type: 'OUT_OF_CREDIT'
		detail: 'No credit remaining'
		status: 402
	}>()
}

// `HTTPError.id`'s second argument annotates a numeric status on the returned class,
// no class-body override needed.
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {
		override readonly detail = 'No credit remaining'
	}

	const app = new Elysia().get('/', () => new OutOfCredit())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]>().toMatchTypeOf<{
		type: 'OUT_OF_CREDIT'
		detail: 'No credit remaining'
		status: 402
	}>()
	expectTypeOf(new OutOfCredit().status).toEqualTypeOf<402>()
}

// `HTTPError.id`'s argument is the *code*: served as its own member and carried
// through a subclass of the factory result, which is how an app builds its
// hierarchy. `type` mirrors it statically — only the runtime `typeBase` widens
// it, which no static type can see.
{
	class AppError extends HTTPError.id('APP_ERROR', 402) {
		override readonly detail = 'denied'
	}

	class Nested extends AppError {}

	expectTypeOf(new AppError().code).toEqualTypeOf<'APP_ERROR'>()
	expectTypeOf(new Nested().code).toEqualTypeOf<'APP_ERROR'>()

	const app = new Elysia().get('/', () => new Nested())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<Response[402]['code']>().toEqualTypeOf<'APP_ERROR'>()
	expectTypeOf<Response[402]['type']>().toEqualTypeOf<'APP_ERROR'>()
}

// A hand-written subclass names its own `type` and carries no token, so the
// document it serves has no `code` member to read.
{
	class Manual extends HTTPError<'MANUAL'> {
		type = 'MANUAL' as const
		override readonly status = 402
		override readonly detail = 'manual'
	}

	const app = new Elysia().get('/', () => new Manual())

	type Response = (typeof app)['~Routes']['get']['response']

	// `not.toHaveProperty` alone also compiles for `string` or `unknown`, so pin
	// that the route resolves to a problem document that simply lacks `code`
	expectTypeOf<keyof Response>().toEqualTypeOf<402>()
	expectTypeOf<Response[402]['type']>().toEqualTypeOf<'MANUAL'>()
	expectTypeOf<
		'code' extends keyof Response[402] ? true : false
	>().toEqualTypeOf<false>()
	expectTypeOf<Response[402]>().not.toHaveProperty('code')
}

// `HTTPError.id`'s second argument accepts a status name and resolves it to the same
// numeric literal, both on the class annotation and the response key.
{
	class Denied extends HTTPError.id('DENIED', 'Payment Required') {
		override readonly detail = 'denied'
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
		override readonly detail = 'denied'
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

// `value` reads what the error was constructed with, and what it returns
// resolves the same sync or async.
{
	class Echo extends HTTPError.id('ECHO', 409) {
		constructor(readonly path: string) {
			super()
		}

		value() {
			return { path: this.path }
		}
	}

	class AsyncEcho extends HTTPError.id('ASYNC_ECHO', 402) {
		constructor(readonly path: string) {
			super()
		}

		async value() {
			return problem(503, { detail: this.path })
		}
	}

	const app = new Elysia()
		.get('/sync', () => new Echo('/sync'))
		.get('/async', () => new AsyncEcho('/async'))

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['sync']['get']['response']>().toEqualTypeOf<{
		409: { path: string }
	}>()
	expectTypeOf<
		keyof Routes['async']['get']['response']
	>().toEqualTypeOf<503>()
	expectTypeOf<
		Routes['async']['get']['response'][503]['detail']
	>().toEqualTypeOf<string>()
}

// `value` wins over `detail` when both are annotated.
{
	class Both extends HTTPError.id('BOTH', 402) {
		override readonly detail = 'loser'

		value() {
			return { winner: 'value' as const }
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
		override readonly detail = 'fell through'

		value(): { raw: true } | undefined {
			return Math.random() > 0.5 ? { raw: true } : undefined
		}
	}

	const app = new Elysia().get('/', () => new Falls())

	type Entry = (typeof app)['~Routes']['get']['response'][402]

	expectTypeOf<Extract<Entry, { raw: true }>>().toEqualTypeOf<{ raw: true }>()
	expectTypeOf<
		Extract<Entry, { type: 'FALLS' }>['detail']
	>().toEqualTypeOf<'fell through'>()
}

// An error without a literal status falls back to 500, still problem-shaped.
{
	class Vague extends HTTPError<'VAGUE'> {
		type = 'VAGUE' as const
		override readonly detail = 'vague'
	}

	const app = new Elysia().get('/', () => new Vague())

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<500>()
	expectTypeOf<Response[500]>().toMatchTypeOf<{
		type: 'VAGUE'
		detail: 'vague'
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
		detail?: string
		status: 403
	}>()
}

// `implements` checks assignability, not member kind: `detail` is declared a
// string, so a plain value satisfies it and a method no longer does.
{
	class ImplValue extends Error implements HTTPError<'IMPL_VALUE'> {
		type = 'IMPL_VALUE' as const
		readonly status = 403
		detail = 'forbidden by policy'
	}

	class ImplMethod extends Error implements HTTPError<'IMPL_METHOD'> {
		type = 'IMPL_METHOD' as const
		readonly status = 403

		// @ts-expect-error `detail` is a string, not a method
		detail() {
			return 'forbidden by policy'
		}
	}

	const app = new Elysia().get('/', () => new ImplValue())

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
		.onError(Denied, () => problem(400, { detail: 'q' }))
		.get('/', () => new Denied())

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][400]['type']
	>().toEqualTypeOf<string>()
}

// The base declares `value` as a method, so a method is the only form an
// owned class can annotate it with — an eagerly assigned value is rejected.
// `detail` is the reverse: a string, never a method.
{
	class EagerDetail extends HTTPError.id('EAGER_DETAIL', 410) {
		override readonly detail = 'known upfront'
	}

	class MethodDetail extends HTTPError.id('METHOD_DETAIL', 410) {
		// @ts-expect-error `detail` is a string, not a method
		async detail() {
			return 'computed later'
		}
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

// A knob typed `unknown` resolves to `unknown`, not to the message fallback:
// the runtime serves whatever it holds (an object is served verbatim) and
// can't see a declared type, so the type can't promise the message either.
// `detail` is a string on `HTTPError`, so only an error implementing the
// contract on its own can carry an opaque one.
{
	class OpaqueValue extends HTTPError.id('OPAQUE_VALUE', 409) {
		value(): unknown {
			return { whatever: true }
		}
	}

	class OpaqueDetail extends Error {
		type = 'OPAQUE_DETAIL' as const
		readonly status = 409 as const
		readonly detail: unknown = { whatever: true }
	}

	const app = new Elysia()
		.get('/value', () => new OpaqueValue())
		.get('/detail', () => new OpaqueDetail())

	// `value` is served raw, so the whole body is `unknown`
	expectTypeOf<
		(typeof app)['~Routes']['value']['get']['response'][409]
	>().toEqualTypeOf<unknown>()
	// `detail` is carried verbatim into the problem document
	expectTypeOf<
		(typeof app)['~Routes']['detail']['get']['response'][409]['detail']
	>().toEqualTypeOf<unknown>()
	// `unknown` may hold `undefined`, so the message arm stands beside it
	expectTypeOf<
		[
			Extract<
				(typeof app)['~Routes']['detail']['get']['response'][409],
				{ detail?: string }
			>
		] extends [never]
			? 'no message arm'
			: 'message arm'
	>().toEqualTypeOf<'message arm'>()
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
		override readonly detail = 'fell through'

		value():
			| ElysiaStatus<503, { esc: true }>
			| { plain: true }
			| undefined {
			return undefined
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
	>().toEqualTypeOf<'fell through'>()
}

// A handler that falls through inherits the escape too.
{
	class Flaky extends HTTPError.id('FLAKY', 402) {
		value() {
			return problem(503, { detail: 'downstream dead' })
		}
	}

	const app = new Elysia()
		.onError(Flaky, () => undefined)
		.get('/', () => new Flaky())

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
		.onError(Flaky, () => status(409, 'handled' as const))
		.get('/', () => new Flaky())

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
		.onError(Error1, problem(400, { detail: 'q' }))
		.onError(Error2, problem(401, { detail: 'q' }))
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
	expectTypeOf<Response[500]>().toEqualTypeOf<Unhandled500>()
	// the handler intercepts Error2 before `value()` runs, so no 418
	expectTypeOf<
		(typeof app)['~Routes']['get']['error']
	>().toEqualTypeOf<Error>()
}

// The same holds for the function registration form.
{
	class Error1 extends HTTPError.id('error1') {}

	const app = new Elysia()
		.onError(Error1, () => problem(400, { detail: 'q' }))
		.get('/', (): Error1 | Error | 'ok' => {
			if (Math.random() > 0.5) return new Error1()
			if (Math.random() > 0.5) return new Error()
			return 'ok'
		})

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<200 | 400 | 500>()
	expectTypeOf<Response[500]>().toEqualTypeOf<Unhandled500>()
}

// Control: a bare `Error` on its own still gets its 500 bucket.
{
	const app = new Elysia().get('/', (): Error | 'ok' =>
		Math.random() > 0.5 ? new Error() : 'ok'
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		500: Unhandled500
	}>()
}

// A bare `Error` beside an *unregistered* self-described class: the
// self-described entry keeps its own status, the bare one keeps 500.
{
	class Denied extends HTTPError.id('denied', 402) {
		override readonly detail = 'no funds'
	}

	const app = new Elysia().get('/', (): Denied | Error | 'ok' => {
		if (Math.random() > 0.5) return new Denied()
		if (Math.random() > 0.5) return new Error()
		return 'ok'
	})

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<keyof Response>().toEqualTypeOf<200 | 402 | 500>()
	expectTypeOf<Response[402]['type']>().toEqualTypeOf<'denied'>()
	expectTypeOf<Response[500]>().toEqualTypeOf<Unhandled500>()
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

	// Every constructor form yields the same instance, carrying the literal
	// `type`, `code` and `status` the class was tagged with — a message or
	// cause never widens them.
	expectTypeOf(new Denied()).toEqualTypeOf<Denied>()
	expectTypeOf(new Denied('no funds')).toEqualTypeOf<Denied>()
	expectTypeOf(
		new Denied('no funds', { cause: new Error('upstream') })
	).toEqualTypeOf<Denied>()
	expectTypeOf(new Denied('no funds').type).toEqualTypeOf<'DENIED'>()
	expectTypeOf(new Denied('no funds').code).toEqualTypeOf<'DENIED'>()
	expectTypeOf(new Denied('no funds').status).toEqualTypeOf<402>()
}

// `TaggedHTTPError` names that class, so one can be held in an annotated
// binding and still construct to its tagged instance.
{
	const Denied: TaggedHTTPError<'DENIED'> = HTTPError.id('DENIED')

	expectTypeOf(new Denied().type).toEqualTypeOf<'DENIED'>()
	expectTypeOf(new Denied('no funds').type).toEqualTypeOf<'DENIED'>()
	expectTypeOf(new Denied('no funds').code).toEqualTypeOf<'DENIED'>()
	expectTypeOf(new Denied('no funds')).toMatchTypeOf<Error>()
}

// `headers` annotates the wire, not the document — it rides along on the
// response without joining the body the error describes.
{
	class Denied extends HTTPError.id('DENIED', 402) {
		override readonly headers = { 'x-reason': 'no-funds' }
		override readonly detail = 'no funds'
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

// A response schema constrains what a handler serves, not the errors it
// returns: those go to the error pipeline, so the schema needn't list them.
// The returned error joins the route at its own status.
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

	const app = new Elysia().get('/', { response: t.String() }, ({ query }) =>
		query.x ? 'ok' : new OutOfCredit()
	)

	type Route = (typeof app)['~Routes']['get']

	expectTypeOf<keyof Route['response']>().toEqualTypeOf<200 | 402>()
	expectTypeOf<Route['response'][200]>().toEqualTypeOf<string>()
	expectTypeOf<
		Route['response'][402]['type']
	>().toEqualTypeOf<'OUT_OF_CREDIT'>()
	expectTypeOf<Route['error']>().toEqualTypeOf<OutOfCredit>()

	// A status the schema declares too can be served either way: the
	// handler's own `status(402, …)`, or the returned error's problem
	// document, which response validation never sees
	const both = new Elysia().get(
		'/',
		{ response: { 200: t.String(), 402: t.Object({ foo: t.String() }) } },
		({ query }) => (query.x ? 'ok' : new OutOfCredit())
	)

	type Both = (typeof both)['~Routes']['get']['response'][402]

	expectTypeOf<Extract<Both, { foo: string }>>().toEqualTypeOf<{
		foo: string
	}>()
	expectTypeOf<
		Extract<Both, { type: string }>['type']
	>().toEqualTypeOf<'OUT_OF_CREDIT'>()

	// A registered handler takes the error over, as without a schema
	const handled = new Elysia()
		.onError(OutOfCredit, () => status(418, 'teapot'))
		.get('/', { response: t.String() }, ({ query }) =>
			query.x ? 'ok' : new OutOfCredit()
		)

	expectTypeOf<
		(typeof handled)['~Routes']['get']['response']
	>().toEqualTypeOf<{ 200: string; 418: 'teapot' }>()

	// The handler's answer is never checked against the schema, so at a
	// status the schema declares too, either can be served
	const collides = new Elysia()
		.onError(OutOfCredit, () => status(418, 'teapot'))
		.get(
			'/',
			{ response: { 200: t.String(), 418: t.Object({ x: t.String() }) } },
			({ query }) => (query.x ? 'ok' : new OutOfCredit())
		)

	expectTypeOf<
		(typeof collides)['~Routes']['get']['response'][418]
	>().toEqualTypeOf<{ x: string } | 'teapot'>()

	// `beforeHandle` errors are forwarded to the error pipeline the same way
	new Elysia().get(
		'/',
		{
			response: t.String(),
			beforeHandle({ query }) {
				if (!query.x) return new OutOfCredit()
			}
		},
		() => 'ok'
	)

	new Elysia()
		.guard({ response: t.String() })
		.onBeforeHandle(({ query }) => {
			if (!query.x) return new OutOfCredit()
		})
		.get('/', () => 'ok')

	// So are `afterHandle` errors
	new Elysia().get(
		'/',
		{
			response: t.String(),
			afterHandle({ query }) {
				if (!query.x) return new OutOfCredit()
			}
		},
		() => 'ok'
	)

	new Elysia()
		.guard({ response: t.String() })
		.onAfterHandle(({ query }) => {
			if (!query.x) return new OutOfCredit()
		})
		.get('/', () => 'ok')

	// Its plain value is still checked
	new Elysia().get(
		'/',
		{
			response: t.String(),
			// @ts-expect-error an afterHandle value must satisfy the schema
			afterHandle: () => 1
		},
		() => 'ok'
	)

	// Neither is a WebSocket beforeHandle's: it is sent as a frame
	new Elysia().ws('/', {
		response: t.String(),
		message() {},
		beforeHandle: () => 'ok'
	})

	// @ts-expect-error a WebSocket afterHandle runs after the send: its value is dropped
	new Elysia().ws('/', {
		response: t.String(),
		message() {},
		afterHandle: () => 'ok'
	})

	// @ts-expect-error a WebSocket beforeHandle error is a frame
	new Elysia().ws('/', {
		response: t.String(),
		message() {},
		beforeHandle: () => new OutOfCredit()
	})

	// @ts-expect-error a WebSocket afterHandle error is a frame
	new Elysia().ws('/', {
		response: t.String(),
		message() {},
		afterHandle: () => new OutOfCredit()
	})
}

// Returned from any `beforeHandle`, the instance's, a guard's or a macro's,
// an error serves the same problem document as from the handler, since it
// goes through the same error pipeline.
{
	const handler = new Elysia().get('/', () =>
		Math.random() > 0.5 ? new OutOfCredit() : ('ok' as const)
	)
	const deny = () => (Math.random() > 0.5 ? new OutOfCredit() : undefined)

	const hook = new Elysia().onBeforeHandle(deny).get('/', () => 'ok' as const)
	const guard = new Elysia()
		.guard({ beforeHandle: deny })
		.get('/', () => 'ok' as const)
	const macro = new Elysia()
		.macro({ deny: { beforeHandle: deny } })
		.get('/', { deny: true }, () => 'ok' as const)

	type Response = (typeof handler)['~Routes']['get']['response']

	expectTypeOf<
		(typeof hook)['~Routes']['get']['response'][402]['type']
	>().toEqualTypeOf<'OUT_OF_CREDIT'>()
	expectTypeOf<
		(typeof hook)['~Routes']['get']['response']
	>().toEqualTypeOf<Response>()
	expectTypeOf<
		(typeof guard)['~Routes']['get']['response']
	>().toEqualTypeOf<Response>()
	expectTypeOf<
		(typeof macro)['~Routes']['get']['response']
	>().toEqualTypeOf<Response>()
	expectTypeOf<
		(typeof macro)['~Routes']['get']['error']
	>().toEqualTypeOf<OutOfCredit>()
}
