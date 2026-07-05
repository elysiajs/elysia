import { Elysia, t } from '../../src'

// types-dx-1: a macro's declared `response` schema types the CONSUMING route's
// contract, so it must ALSO constrain the route handler's return — exactly as a
// route-local `response` schema does. Before the fix, `InlineHandler` gated the
// handler return on the route-local `Route['response']` (empty for a macro-only
// route) and never bound `MacroContext['response']`, so ANY return compiled.
// The fix delegates `InlineHandler` to `InlineHandlerNonMacro<Route &
// MacroContext, ...>`, folding the macro response into the checked route so a
// wrong return is a type error. These pins fail if that binding regresses.

const macro = new Elysia().macro({
	withId: {
		response: t.Object({ id: t.Number() })
	}
})

// wrong-shape object under a macro-supplied response must error
macro.get(
	'/obj',
	{ withId: true },
	// @ts-expect-error macro response { id: number } not satisfied by { name }
	() => ({ name: 'z' })
)

// primitive wrong return must error
macro.get(
	'/num',
	{ withId: true },
	// @ts-expect-error number is not { id: number }
	() => 123
)

// symbol / bigint wrong returns must error
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

// async wrong return must error (the fix additionally closes the async leak)
macro.get(
	'/async',
	{ withId: true },
	// @ts-expect-error async wrong shape not satisfied
	async () => ({ name: 'z' })
)

// a macro with a PRIMITIVE response must constrain too (regression proved the
// primitive-macro-response case leaked exactly like the object case)
const macroStr = new Elysia().macro({ asStr: { response: t.String() } })
macroStr.get(
	'/str',
	{ asStr: true },
	// @ts-expect-error number where macro response string expected
	() => 123
)

// CORRECT returns must still COMPILE — bare value, async, generator, and
// `status(...)`-wrapped — so the fix only rejects genuinely-wrong returns.
macro.get('/ok', { withId: true }, () => ({ id: 1 }))
macro.get('/ok-async', { withId: true }, async () => ({ id: 1 }))
macro.get('/ok-status', { withId: true }, ({ status }) => status(200, { id: 1 }))

// a wrong body inside status(...) must still error under a macro response
macro.get(
	'/status-wrong',
	{ withId: true },
	({ status }) =>
		// @ts-expect-error status(200, { name }) violates macro response
		status(200, { name: 'z' })
)

// The macro response must not poison the Eden route tree to any/unknown: the
// stored 200 body stays the concrete macro schema shape.
const okApp = macro.get('/ok2', { withId: true }, () => ({ id: 1 }))
type IsAny<T> = 0 extends 1 & T ? true : false
type Ok2Body = (typeof okApp)['~Routes']['ok2']['get']['response'][200]
const _edenConcrete: IsAny<Ok2Body> = false

// Macro-derived (`resolve`-channel) values and instance `derive` values remain
// available and typed in the handler context — the delegation must preserve the
// merged macro context, not just the response.
new Elysia()
	.derive(() => ({ traceId: 'x' as const }))
	.macro({ auth: { derive: () => ({ userId: 1 as const }) } })
	.get('/ctx', { auth: true }, (ctx) => {
		const _t: 'x' = ctx.traceId
		const _u: 1 = ctx.userId
		return { ok: true }
	})

// ---------------------------------------------------------------------
// NON-MACRO regression guard: the non-macro path was already fully checked
// and must be UNCHANGED by this fix.
// ---------------------------------------------------------------------

// non-macro object response: wrong return still errors
new Elysia().get(
	'/nm-obj',
	{ response: t.Object({ id: t.Number() }) },
	// @ts-expect-error wrong object (non-macro, unchanged)
	() => ({ name: 'z' })
)

// bare-value handlers with no schema still compile
new Elysia().get('/nm-lit', () => 'lit')
new Elysia().get('/nm-obj-val', () => ({ a: 1 }))

// bare-value handler with a matching response schema still compiles
new Elysia().get(
	'/nm-val',
	{ response: t.Object({ name: t.String() }) },
	() => ({ name: 'a' })
)
