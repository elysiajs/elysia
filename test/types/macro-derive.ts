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

// Named plugins retain exact context from a selected function-form macro.
{
	const plugin = new Elysia({ name: 'macro-derive' })
		.macro({
			objForm: {
				derive: () => ({
					iris: { publish: (value: unknown) => String(value) }
				})
			},
			fnForm(value: boolean | undefined) {
				if (!value) return {}

				return {
					derive: () => ({
						iris: { publish: (value: unknown) => String(value) }
					})
				}
			}
		})
		.derive('global', () => ({
			iris: { touch: (route: string) => route }
		}))

	new Elysia()
		.use(plugin)
		.get('/', { fnForm: true }, ({ iris }) => {
			expectTypeOf(iris.publish).toEqualTypeOf<
				(value: unknown) => string
			>()
			expectTypeOf(iris.touch).toEqualTypeOf<(route: string) => string>()
			// @ts-expect-error Named plugins preserve exact macro-derived context.
			iris.definitelyNotAThing()
		})
}

// Conditional function-form macro responses survive named plugin composition.
{
	const plugin = new Elysia({ name: 'macro-before-handle' }).macro({
		authorize(value: boolean | undefined) {
			if (!value) return {}

			return { beforeHandle: ({ status }) => status(401) }
		}
	})
	const app = new Elysia()
		.use(plugin)
		.get('/', { authorize: true }, () => 'ok' as const)

	type Response = (typeof app)['~Routes']['get']['response']
	expectTypeOf<Response[401]>().toEqualTypeOf<'Unauthorized'>()
	expectTypeOf<keyof Response>().toEqualTypeOf<200 | 401>()
}
