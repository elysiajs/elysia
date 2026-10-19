import { expectTypeOf } from 'expect-type'
import { Elysia, HTTPError, status } from '../../src'

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

	new Elysia().use(plugin).get('/', { fnForm: true }, ({ iris }) => {
		expectTypeOf(iris.publish).toEqualTypeOf<(value: unknown) => string>()
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

// A macro's `derive` returning a raw `Error` answers like a `beforeHandle`'s:
// through `.onError(Class)` dispatch, never derived into the context
{
	class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}
	class Lib extends Error {}

	const credit = ({ request }: { request: Request }) =>
		request.headers.has('x-credit')
			? new OutOfCredit()
			: { user: 'u' as const }

	const app = new Elysia()
		.macro({ credit: { derive: credit } })
		.get('/', { credit: true }, (context) => {
			expectTypeOf(context.user).toEqualTypeOf<'u'>()
			expectTypeOf(context).not.toHaveProperty('stack')

			return context.user
		})
	const handler = new Elysia().get('/', ({ request }) =>
		request.headers.has('x-credit') ? new OutOfCredit() : ('u' as const)
	)

	type Route = (typeof app)['~Routes']['get']
	type Handler = (typeof handler)['~Routes']['get']

	expectTypeOf<Route['response']>().toEqualTypeOf<Handler['response']>()
	expectTypeOf<Route['error']>().toEqualTypeOf<OutOfCredit>()

	const handled = new Elysia()
		.onError(OutOfCredit, () => status(418, 'teapot' as const))
		.macro({ credit: { derive: credit } })
		.get('/', { credit: true }, ({ user }) => user)

	expectTypeOf<
		Pick<(typeof handled)['~Routes']['get'], 'response' | 'error'>
	>().toEqualTypeOf<{ response: { 200: 'u'; 418: 'teapot' }; error: never }>()

	// beside a status the same derive returns, and a plain error's 500
	const both = new Elysia()
		.macro({
			auth: {
				derive: ({ request }) =>
					request.headers.has('x-lib')
						? new Lib('x')
						: request.headers.has('x-auth')
							? status(401, 'no' as const)
							: { user: 'u' as const }
			}
		})
		.get('/', { auth: true }, ({ user }) => user)

	expectTypeOf<(typeof both)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'u'
		401: 'no'
		500: Unhandled500
	}>()

	// an error with an index signature is an error still, as from `.derive()`
	class DictError extends HTTPError.id('DENIED', 403) {
		[key: string]: unknown
	}

	const dict = new Elysia()
		.macro({ denied: { derive: () => new DictError() } })
		.get('/', { denied: true }, () => 'ok' as const)
	const direct = new Elysia()
		.derive(() => new DictError())
		.get('/', () => 'ok' as const)

	expectTypeOf<
		keyof (typeof dict)['~Routes']['get']['response']
	>().toEqualTypeOf<200 | 403>()
	expectTypeOf<(typeof dict)['~Routes']['get']['response']>().toEqualTypeOf<
		(typeof direct)['~Routes']['get']['response']
	>()
}
