import { expectTypeOf } from 'expect-type'
import { Elysia, HTTPError, status, t } from '../../src'

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

// A function-form macro is still called with `false` (only an object macro
// is skipped), so its schema validates and its derive runs: type what it
// returns, as the runtime applies it
{
	const app = new Elysia()
		.macro({
			key: (enabled: boolean) => ({
				headers: t.Object({ 'x-key': t.String() }),
				derive: () => ({ who: enabled ? 'admin' : 'guest' })
			})
		})
		.get('/', { key: false }, ({ headers, who }) => {
			expectTypeOf(headers['x-key']).toEqualTypeOf<string>()
			expectTypeOf(who).toEqualTypeOf<string>()

			return who
		})

	type Route = (typeof app)['~Routes']['get']
	expectTypeOf<Route['headers']>().toEqualTypeOf<{ 'x-key': string }>()
	expectTypeOf<Route['response'][422]>().not.toBeNever()
}

// A macro `derive` that can return nothing leaves its keys undefined on that
// request, as a plain `.derive()` does: optional, never required. Same for a
// function macro that returns `derive` on some calls only
{
	new Elysia()
		.macro({
			auth: {
				derive({ headers }) {
					if (!headers.authorization) return

					return { user: 'alice' as const }
				}
			},
			authFn: (on: boolean) => ({
				async derive({ headers }) {
					if (!headers.authorization) return

					return { user2: 'bob' as const }
				}
			}),
			role: (role: 'admin' | 'none') =>
				role === 'none' ? {} : { derive: () => ({ who: role }) },
			both: {
				derive: [
					({ headers }) =>
						headers.a ? { maybe: 'm' as const } : undefined,
					() => ({ always: 'a' as const })
				]
			}
		})
		.get('/a', { auth: true }, ({ user }) => {
			expectTypeOf(user).toEqualTypeOf<'alice' | undefined>()
		})
		.get('/b', { authFn: true }, ({ user2 }) => {
			expectTypeOf(user2).toEqualTypeOf<'bob' | undefined>()
		})
		.get('/c', { role: 'none' }, ({ who }) => {
			expectTypeOf(who).toEqualTypeOf<'admin' | undefined>()
		})
		.get('/d', { both: true }, ({ maybe, always }) => {
			expectTypeOf(maybe).toEqualTypeOf<'m' | undefined>()
			expectTypeOf(always).toEqualTypeOf<'a'>()
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

// An object macro set to a value only known as `boolean` (`{ auth: flag }`, a
// hoisted `{ auth: true }`, a spread) may apply: its hooks may answer (401
// below) and its schema may validate (422), so both are typed. What it
// derives may be absent, so those keys are optional. A literal `false`
// still skips it entirely
{
	const flag = Math.random() > 0.5
	const authed = { auth: true }

	const app = new Elysia()
		.macro({
			auth: {
				headers: t.Object({ 'x-key': t.String() }),
				beforeHandle({ request }) {
					if (!request.headers.has('x-key'))
						return status(401, 'auth' as const)
				},
				derive: () => ({ user: 'alice' as const })
			}
		})
		.get('/flag', { auth: flag }, ({ user }) => {
			expectTypeOf(user).toEqualTypeOf<'alice' | undefined>()

			return 'ok' as const
		})
		.get('/hoisted', authed, () => 'ok' as const)
		.get('/spread', { ...authed }, () => 'ok' as const)
		.guard({ auth: flag }, (app) =>
			app.get('/guarded', ({ user }) => {
				expectTypeOf(user).toEqualTypeOf<'alice' | undefined>()

				return 'ok' as const
			})
		)
		.get('/off', { auth: false }, (context) => {
			expectTypeOf(context).not.toHaveProperty('user')

			return 'ok' as const
		})
		.get('/on', { auth: true }, ({ user }) => {
			expectTypeOf(user).toEqualTypeOf<'alice'>()

			return 'ok' as const
		})

	type Routes = (typeof app)['~Routes']

	expectTypeOf<keyof Routes['flag']['get']['response']>().toEqualTypeOf<
		200 | 401 | 422
	>()
	expectTypeOf<
		Routes['flag']['get']['response'][401]
	>().toEqualTypeOf<'auth'>()
	expectTypeOf<keyof Routes['hoisted']['get']['response']>().toEqualTypeOf<
		200 | 401 | 422
	>()
	expectTypeOf<keyof Routes['spread']['get']['response']>().toEqualTypeOf<
		200 | 401 | 422
	>()
	expectTypeOf<keyof Routes['guarded']['get']['response']>().toEqualTypeOf<
		200 | 401 | 422
	>()
	expectTypeOf<Routes['off']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
	}>()
}

// More ways a macro may not apply, each typed like the `boolean` flag above:
// an option left out (`{ auth?: boolean }`), a macro enabled by one set to a
// `boolean`, a function macro that may return nothing. And a macro that may
// not apply can't type the handler's input by its schema: when it's off the
// handler gets the input unvalidated (`false as boolean` would crash on
// `headers['x-key'].toUpperCase()`). A client still sends it and 422 stays
{
	const optional: { auth?: boolean } = { auth: true }
	const flag = Math.random() > 0.5

	const app = new Elysia()
		.macro({
			auth: {
				headers: t.Object({ 'x-key': t.String() }),
				beforeHandle: () =>
					Math.random() ? status(401, 'auth' as const) : undefined,
				derive: () => ({ user: 'alice' as const })
			},
			child: { derive: () => ({ nested: 'value' as const }) },
			parent: { child: true },
			maybe: (on: boolean) =>
				on ? { derive: () => ({ who: 'bob' as const }) } : undefined
		})
		.get('/optional', optional, ({ user }) => {
			expectTypeOf(user).toEqualTypeOf<'alice' | undefined>()

			return 'ok' as const
		})
		.get('/nested', { parent: flag }, ({ nested }) => {
			expectTypeOf(nested).toEqualTypeOf<'value' | undefined>()

			return 'ok' as const
		})
		.get('/maybe', { maybe: false }, ({ who }) => {
			expectTypeOf(who).toEqualTypeOf<'bob' | undefined>()

			return 'ok' as const
		})
		.get('/flag', { auth: flag }, ({ headers }) => {
			expectTypeOf(headers).toEqualTypeOf<
				Record<string, string | undefined>
			>()

			return 'ok' as const
		})
		.get('/on', { auth: true }, ({ headers }) => {
			expectTypeOf(headers).toEqualTypeOf<{ 'x-key': string }>()

			return 'ok' as const
		})

	type Routes = (typeof app)['~Routes']

	expectTypeOf<keyof Routes['optional']['get']['response']>().toEqualTypeOf<
		200 | 401 | 422
	>()
	expectTypeOf<keyof Routes['flag']['get']['response']>().toEqualTypeOf<
		200 | 401 | 422
	>()
	expectTypeOf<Routes['flag']['get']['headers']>().toEqualTypeOf<{
		'x-key': string
	}>()
}
