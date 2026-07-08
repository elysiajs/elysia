import { expectTypeOf } from 'expect-type'
import { Elysia } from '../../src'

// Pins the shorthand object-form macro: `{ name: { derive: () => result } }` with a
// boolean flag at the call-site. If inference regresses to `any` or `unknown`, the
// `toEqualTypeOf` assertions below will fail the type gate.

// The derive result type must be exact, not widened to `any` or `unknown`.
{
	new Elysia()
		.macro({ withUser: { derive: () => ({ user: 'alice' as const }) } })
		.get('/', { withUser: true }, ({ user }) => {
			// Regression guard: if the infer regresses to `any`, this passes silently.
			// `toEqualTypeOf` fails when `typeof user` is `any` because `any` does not
			// equal `'alice'`.
			expectTypeOf(user).toEqualTypeOf<'alice'>()
		})
}

// A route WITHOUT the macro flag must NOT have `user` on its context — prevents
// the derive from leaking into unrelated handlers.
{
	new Elysia()
		.macro({ withUser: { derive: () => ({ user: 'alice' as const }) } })
		.get('/', { withUser: false }, (context) => {
			expectTypeOf(context).not.toHaveProperty('user')
		})
}

// Multi-property derive: all returned fields must appear with exact types.
{
	new Elysia()
		.macro({
			withSession: {
				derive: () => ({
					userId: 42 as number,
					role: 'admin' as const
				})
			}
		})
		.get('/', { withSession: true }, ({ userId, role }) => {
			expectTypeOf(userId).toEqualTypeOf<number>()
			expectTypeOf(role).toEqualTypeOf<'admin'>()
		})
}

// Derive sees the query (macro own-ctx has default Singleton — query is
// `Record<string, string | undefined>`). The derive result type is still exact.
{
	new Elysia()
		.macro({
			gate: {
				derive: ({ query }) => ({
					value: query.deny ? 'denied' : 'ok'
				})
			}
		})
		.get('/', { gate: true }, ({ value }) => {
			expectTypeOf(value).toEqualTypeOf<string>()
		})
}
