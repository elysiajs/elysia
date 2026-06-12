import { Elysia, t } from '../../src'
import { expectTypeOf } from 'expect-type'

// own handler ctx sees the macro's own schema (previously named-form-only)
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

// schema AND derive result reach the consuming route
{
	new Elysia()
		.macro({
			thing: {
				body: t.Object({ x: t.String() }),
				derive: ({ body }) => ({ who: body.x })
			}
		})
		.post(
			'/',
			({ body, who }) => {
				expectTypeOf(body).toEqualTypeOf<{ x: string }>()
				expectTypeOf(who).toEqualTypeOf<string>()

				return 'ok'
			},
			{ thing: true }
		)
}

// function form: argument type + own handler ctx + derive flow
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
		.get(
			'/',
			({ role }) => {
				expectTypeOf(role).toEqualTypeOf<'admin' | 'user'>()
			},
			{ role: 'admin' }
		)
}

// function form with schema: the route receives schema + derive result.
// The fn form's OWN handlers see the schema-less default ctx (the schema
// lives inside the function's return — TypeScript cannot thread it back
// into a sibling property's contextual type); annotate the ctx parameter
// or use the object form when the own handler needs the schema typed
{
	new Elysia()
		.macro({
			limit: (max: number) => ({
				query: t.Object({ page: t.Number() }),
				derive: ({ query }) => {
					expectTypeOf(query).toEqualTypeOf<Record<string, string>>()

					return { capped: max }
				}
			})
		})
		.get(
			'/',
			({ query, capped }) => {
				expectTypeOf(query).toEqualTypeOf<{ page: number }>()
				expectTypeOf(capped).toEqualTypeOf<number>()
			},
			{ limit: 10 }
		)
}

// a bare functional macro is rejected — it has no name to register under
{
	// @ts-expect-error use `.macro({ name: fn })` instead
	new Elysia().macro(() => ({ beforeHandle() {} }))
}

// a typo'd definition key is rejected
{
	new Elysia().macro({
		thing: {
			body: t.Object({ x: t.String() }),
			// @ts-expect-error `drive` is not a macro property (typo of `derive`)
			drive: () => ({ a: 1 })
		}
	})
}

// a typo'd macro (inherited) name is rejected
{
	new Elysia()
		.macro({ auth: { derive: () => ({ user: 'a' }) } })
		.macro({
			admin: {
				// @ts-expect-error `auth2` is not a registered macro
				auth2: true
			}
		})
}

// referencing a previously-registered macro or a sibling still works
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
		.get(
			'/',
			({ user, a, level }) => {
				expectTypeOf(user).toEqualTypeOf<string>()
				expectTypeOf(a).toEqualTypeOf<'a'>()
				expectTypeOf(level).toEqualTypeOf<number>()
			},
			{ admin: true }
		)
}

// the macro's own declared response does NOT constrain its own hooks —
// hook status returns are collected additively into the route's response
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
		.get('/', () => 'ok' as const, { auth: true })

	type Response = (typeof app)['~Routes']['get']['response']

	expectTypeOf<Response['409']>().toEqualTypeOf<'Conflict'>()
	expectTypeOf<Response['410']>().toEqualTypeOf<'Gone'>()
}
