import { expectTypeOf } from 'expect-type'
import { Elysia } from '../../src'

// Object-form macros expose exact derived types only when enabled.
{
	new Elysia()
		.macro({ withUser: { derive: () => ({ user: 'alice' as const }) } })
		.get('/', { withUser: true }, ({ user }) => {
			expectTypeOf(user).toEqualTypeOf<'alice'>()
		})
}

// Disabled macros do not add their derived context.
{
	new Elysia()
		.macro({ withUser: { derive: () => ({ user: 'alice' as const }) } })
		.get('/', { withUser: false }, (context) => {
			expectTypeOf(context).not.toHaveProperty('user')
		})
}

// Every derived property retains its exact type.
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

// Macro derivation receives the schemaless query context.
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
