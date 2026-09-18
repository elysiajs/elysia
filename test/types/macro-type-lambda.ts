import { expectTypeOf } from 'expect-type'
import { Elysia, t } from '../../src'
import type { AnySchema, MacroTypeLambda, UnwrapSchema } from '../../src'

interface ChannelLambda extends MacroTypeLambda {
	output: this['input'] extends { of: infer S extends AnySchema }
		? { custom: UnwrapSchema<S> }
		: { custom: unknown }
}

const channel = new Elysia({ name: 'channel' }).macro({
	channel: (option: {
		of: AnySchema
	}): { $type?: ChannelLambda; derive(): unknown } => ({
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
				expectTypeOf(custom).toEqualTypeOf<{ id: string; name: string }>()
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
			scoped: (option: {
				of: AnySchema
				readonly?: boolean
			}): { $type?: ScopedLambda; derive(): unknown } => ({
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
			loose: (_option: {
				of?: AnySchema
				label: string
			}): { $type?: LooseLambda; derive(): unknown } => ({
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
		output: this['input'] extends true ? { flagged: 'on' } : { flagged: 'off' }
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
	new Elysia()
		.use(channel)
		.post(
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
