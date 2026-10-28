import { expectTypeOf } from 'expect-type'
import { Elysia, macroType, t } from '../../src'
import type { AnySchema, MacroTypeLambda, UnwrapSchema } from '../../src'

interface ChannelLambda extends MacroTypeLambda {
	output: this['input'] extends { of: infer S extends AnySchema }
		? { custom: UnwrapSchema<S> }
		: { custom: unknown }
}

const channel = new Elysia({ name: 'channel' }).macro({
	channel: (option: { of: AnySchema }) => ({
		$type: macroType<ChannelLambda>(),
		derive: () => ({ of: option.of })
	})
})

// One macro, two call sites, two exact context types.
{
	new Elysia()
		.use(channel)
		.get(
			'/room',
			{ channel: { of: t.Object({ id: t.String(), name: t.String() }) } },
			({ custom }) => {
				expectTypeOf(custom).toEqualTypeOf<{
					id: string
					name: string
				}>()
			}
		)
		.get(
			'/stats',
			{ channel: { of: t.Object({ count: t.Number() }) } },
			({ custom }) => {
				expectTypeOf(custom).not.toBeAny()
				expectTypeOf(custom).toEqualTypeOf<{ count: number }>()
			}
		)
}

// The lambda receives the whole hook value, not just one member.
{
	interface ScopedLambda extends MacroTypeLambda {
		output: this['input'] extends {
			of: infer S extends AnySchema
			readonly?: infer R
		}
			? R extends true
				? { scoped: Readonly<UnwrapSchema<S>> }
				: { scoped: UnwrapSchema<S> }
			: {}
	}

	new Elysia()
		.macro({
			scoped: (option: { of: AnySchema; readonly?: boolean }) => ({
				$type: macroType<ScopedLambda>(),
				derive: () => ({ of: option.of })
			})
		})
		.get(
			'/mutable',
			{ scoped: { of: t.Object({ n: t.Number() }) } },
			({ scoped }) => {
				expectTypeOf(scoped).toEqualTypeOf<{ n: number }>()
			}
		)
		.get(
			'/frozen',
			{ scoped: { of: t.Object({ n: t.Number() }), readonly: true } },
			({ scoped }) => {
				expectTypeOf(scoped).toEqualTypeOf<Readonly<{ n: number }>>()
			}
		)
}

// A hook value missing the lambda's pattern takes the fallback branch.
// (The hook value must not be `{}`: `false extends {}` is true, so an
// empty object trips ReturnTypeIfPossible's disabled branch.)
{
	interface LooseLambda extends MacroTypeLambda {
		output: this['input'] extends { of: infer S extends AnySchema }
			? { custom: UnwrapSchema<S> }
			: { custom: unknown }
	}

	new Elysia()
		.macro({
			loose: (_option: { of?: AnySchema; label: string }) => ({
				$type: macroType<LooseLambda>(),
				derive: () => ({})
			})
		})
		.get('/loose', { loose: { label: 'x' } }, ({ custom }) => {
			expectTypeOf(custom).toEqualTypeOf<unknown>()
		})
}

// The lambda composes with the macro's own derived runtime context.
{
	interface EntriesLambda extends MacroTypeLambda {
		output: this['input'] extends { of: infer S extends AnySchema }
			? { entries: Readonly<Record<string, UnwrapSchema<S>>> }
			: {}
	}

	new Elysia()
		.macro({
			live: (option: {
				of: AnySchema
			}): {
				$type?: EntriesLambda
				derive(): { session: string }
			} => ({
				derive: () => ({ session: '', of: option.of })
			})
		})
		.get(
			'/both',
			{ live: { of: t.Object({ x: t.Number() }) } },
			({ entries, session }) => {
				expectTypeOf(entries).toEqualTypeOf<
					Readonly<Record<string, { x: number }>>
				>()
				expectTypeOf(session).toEqualTypeOf<string>()
			}
		)
}

// Untagged macros are untouched beside a tagged one.
{
	new Elysia()
		.use(channel)
		.macro({ withUser: { derive: () => ({ user: 'alice' as const }) } })
		.get(
			'/mixed',
			{ channel: { of: t.Object({ id: t.String() }) }, withUser: true },
			({ custom, user }) => {
				expectTypeOf(custom).toEqualTypeOf<{ id: string }>()
				expectTypeOf(user).toEqualTypeOf<'alice'>()
			}
		)
}

// Object-form macros carry the phantom tag through an annotated value.
{
	interface FlagLambda extends MacroTypeLambda {
		output: this['input'] extends true
			? { flagged: 'on' }
			: { flagged: 'off' }
	}

	const flagged: { $type?: FlagLambda; beforeHandle(): void } = {
		beforeHandle() {}
	}

	new Elysia().macro({ flagged }).get('/flag', { flagged: true }, (ctx) => {
		expectTypeOf(ctx.flagged).toEqualTypeOf<'on'>()
	})
}

// Route schemas stay exact beside a lambda contribution.
{
	new Elysia().use(channel).post(
		'/write/:id',
		{
			channel: { of: t.Object({ id: t.String() }) },
			params: t.Object({ id: t.Number() }),
			body: t.Object({ msg: t.String() })
		},
		({ custom, params, body }) => {
			expectTypeOf(custom).toEqualTypeOf<{ id: string }>()
			expectTypeOf(params).toEqualTypeOf<{ id: number }>()
			expectTypeOf(body).toEqualTypeOf<{ msg: string }>()
		}
	)
}

// Early returns without the marker keep the lambda.
{
	interface EarlyLambda extends MacroTypeLambda {
		output: this['input'] extends { of: infer S extends AnySchema }
			? { early: UnwrapSchema<S> }
			: {}
	}

	new Elysia()
		.macro({
			early: (option: { of: AnySchema } | false) => {
				if (!option) return {}

				return { $type: macroType<EarlyLambda>(), derive: () => ({}) }
			}
		})
		.get(
			'/early',
			{ early: { of: t.Object({ n: t.Number() }) } },
			({ early }) => {
				expectTypeOf(early).toEqualTypeOf<{ n: number }>()
			}
		)
}

// #2031 A generic macro's return is typed with its type parameter at the
// constraint, so the schema built from each call site's argument needs the
// lambda's schema members.
{
	const Envelope = <T extends AnySchema>(data: T) =>
		t.Object({ code: t.Number(), data: t.Union([data, t.Null()]) })

	interface EnvelopeLambda extends MacroTypeLambda {
		response: ReturnType<typeof Envelope<Extract<this['input'], AnySchema>>>
	}

	const erased = new Elysia()
		.macro({
			res<T extends AnySchema>(data: T) {
				return { response: Envelope(data) }
			}
		})
		.get('/', { res: t.Number() }, () => ({ code: 0, data: 'any' }))

	// Without the lambda TypeScript can't apply the argument: `data` erases
	expectTypeOf<
		(typeof erased)['~Routes']['get']['response'][200]['data']
	>().toEqualTypeOf<unknown>()

	const app = new Elysia()
		.macro({
			res<T extends AnySchema>(data: T) {
				return {
					$type: macroType<EnvelopeLambda>(),
					response: Envelope(data)
				}
			}
		})
		.get('/number', { res: t.Number() }, () => ({ code: 0, data: 1 }))
		.get('/string', { res: t.String() }, () => ({ code: 0, data: 'a' }))
		// @ts-expect-error the call site's schema constrains the handler
		.get('/wrong', { res: t.Number() }, () => ({ code: 0, data: 'a' }))
		.guard({ res: t.Boolean() }, (app) =>
			app
				.get('/guard', () => ({ code: 0, data: true }))
				// @ts-expect-error a guard's macro value applies too
				.get('/guard-wrong', () => ({ code: 0, data: 1 }))
		)

	expectTypeOf<
		(typeof app)['~Routes']['number']['get']['response'][200]
	>().toEqualTypeOf<{ code: number; data: number | null }>()
	expectTypeOf<
		(typeof app)['~Routes']['string']['get']['response'][200]
	>().toEqualTypeOf<{ code: number; data: string | null }>()
}

// Schema members compose with `output`, and a status map goes through an
// alias since `this` isn't allowed in a nested type literal.
{
	type EchoResponse<S> = {
		200: Extract<S, AnySchema>
		418: ReturnType<typeof t.String>
	}
	type Echo<S> = { echo: UnwrapSchema<Extract<S, AnySchema>> }

	interface EchoLambda extends MacroTypeLambda {
		body: Extract<this['input'], AnySchema>
		response: EchoResponse<this['input']>
		output: Echo<this['input']>
	}

	const app = new Elysia()
		.macro({
			echo: <T extends AnySchema>(schema: T) => ({
				$type: macroType<EchoLambda>(),
				body: schema,
				response: { 200: schema, 418: t.String() },
				derive: () => ({})
			})
		})
		.post(
			'/',
			{ echo: t.Object({ n: t.Number() }) },
			({ body, echo, status }) => {
				expectTypeOf(body).toEqualTypeOf<{ n: number }>()
				expectTypeOf(echo).toEqualTypeOf<{ n: number }>()

				if (body.n) return status(418, 'tea')

				return body
			}
		)

	expectTypeOf<
		(typeof app)['~Routes']['post']['response'][418]
	>().toEqualTypeOf<string>()
}
