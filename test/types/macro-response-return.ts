import { Elysia, t } from '../../src'

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
