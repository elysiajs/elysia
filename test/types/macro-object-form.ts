import { Elysia, t } from '../../src'
import { expectTypeOf } from 'expect-type'

// Object-form macro hooks receive the macro's schema.
{
	new Elysia().macro({
		thing: {
			body: t.Object({ x: t.String() }),
			beforeHandle: ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ x: string }>()
			},
			derive: ({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ x: string }>()

				return { who: body.x }
			}
		}
	})
}

// Routes using an object-form macro receive its schema and derived values.
{
	new Elysia()
		.macro({
			thing: {
				body: t.Object({ x: t.String() }),
				derive: ({ body }) => ({ who: body.x })
			}
		})
		.post('/', { thing: true }, ({ body, who }) => {
			expectTypeOf(body).toEqualTypeOf<{ x: string }>()
			expectTypeOf(who).toEqualTypeOf<string>()

			return 'ok'
		})
}

// Named models type both macro hooks and routes using the macro.
{
	new Elysia()
		.model({ 'test.a': t.Object({ a: t.String() }) })
		.macro({
			named: {
				body: 'test.a',
				beforeHandle: ({ body }) => {
					expectTypeOf(body).toEqualTypeOf<{ a: string }>()
				},
				derive: ({ body }) => ({ who: body.a })
			}
		})
		.post('/', { named: true }, ({ body, who }) => {
			expectTypeOf(body).toEqualTypeOf<{ a: string }>()
			expectTypeOf(who).toEqualTypeOf<string>()

			return 'ok'
		})
}

// Function-form macro options determine derived route values.
{
	new Elysia()
		.macro({
			role: (role: 'admin' | 'user') => ({
				derive: ({ headers }) => {
					expectTypeOf(headers).toEqualTypeOf<
						Record<string, string | undefined>
					>()

					return { role }
				}
			})
		})
		.get('/', { role: 'admin' }, ({ role }) => {
			expectTypeOf(role).toEqualTypeOf<'admin' | 'user'>()
		})
}

// A function-form macro passes its schema and derived values to the route.
// Its own derive callback keeps the schemaless context type.
{
	new Elysia()
		.macro({
			limit: (max: number) => ({
				query: t.Object({ page: t.Number() }),
				derive: ({ query }) => {
					expectTypeOf(query).toEqualTypeOf<
						Record<string, string | undefined>
					>()

					return { capped: max }
				}
			})
		})
		.get('/', { limit: 10 }, ({ query, capped }) => {
			expectTypeOf(query).toEqualTypeOf<{ page: number }>()
			expectTypeOf(capped).toEqualTypeOf<number>()
		})
}

// Unknown macro definition keys are rejected.
{
	new Elysia().macro({
		thing: {
			body: t.Object({ x: t.String() }),
			// @ts-expect-error `drive` is not a macro property (typo of `derive`)
			drive: () => ({ a: 1 })
		}
	})
}

// Unregistered inherited macro names are rejected.
{
	new Elysia().macro({ auth: { derive: () => ({ user: 'a' }) } }).macro({
		admin: {
			// @ts-expect-error `auth2` is not a registered macro
			auth2: true
		}
	})
}

// Macros can reference earlier and sibling macro definitions.
{
	new Elysia()
		.macro({ auth: { derive: () => ({ user: 'a' }) } })
		.macro({
			a: { derive: () => ({ a: 'a' as const }) },
			admin: {
				auth: true,
				a: true,
				derive: () => ({ level: 1 })
			}
		})
		.get('/', { admin: true }, ({ user, a, level }) => {
			expectTypeOf(user).toEqualTypeOf<string>()
			expectTypeOf(a).toEqualTypeOf<'a'>()
			expectTypeOf(level).toEqualTypeOf<number>()
		})
}

// Declared macro responses and lifecycle status returns both reach the route.
{
	const app = new Elysia()
		.macro({
			auth: {
				response: { 409: t.Literal('Conflict') },
				beforeHandle: ({ status }) => {
					if (Math.random() < 0.05) return status(410)
				}
			}
		})
		.get('/', { auth: true }, () => 'ok' as const)

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<Response['409']>().toEqualTypeOf<'Conflict'>()
	expectTypeOf<Response['410']>().toEqualTypeOf<'Gone'>()
}

{
	new Elysia()
		.macro({
			ip: {
				derive({ request, server }) {
					return { ip: server?.requestIP(request)?.address }
				}
			}
		})
		.macro({
			thing: {
				ip: true,
				beforeHandle({ ip }) {
					expectTypeOf(ip).toEqualTypeOf<string | undefined>()
				},
				derive({ ip }) {
					expectTypeOf(ip).toEqualTypeOf<string | undefined>()

					return { forwarded: ip }
				}
			}
		})
}

{
	new Elysia()
		.macro({ auth: { derive: () => ({ user: 'a' as const }) } })
		.macro({
			plain: {
				beforeHandle(ctx) {
					// @ts-expect-error `user` is not referenced, so not present
					ctx.user
				}
			}
		})
}

{
	new Elysia()
		.macro({
			auth: { derive: () => ({ user: 'lilith' as const }) }
		})
		.macro({
			role: (level: 'admin' | 'user') => ({
				auth: true,
				beforeHandle() {},
				derive: () => ({ level })
			})
		})
		.get('/', { role: 'admin' }, ({ user, level }) => {
			expectTypeOf(user).toEqualTypeOf<'lilith'>()
			expectTypeOf(level).toEqualTypeOf<'admin' | 'user'>()
		})
}
