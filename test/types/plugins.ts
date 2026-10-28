import { Elysia, t } from '../../src'
import { expectTypeOf } from 'expect-type'

const plugin = async (app: Elysia) =>
	app.decorate('decorate', 'a').state('state', 'a').model({
		string: t.String()
	})

export default plugin

// `new Elysia({ as })` registers every scope-less hook at that scope, so a
// plugin's `derive`/`onBeforeHandle`/`onAfterHandle`/`onError` reach the
// parent that uses it, as the runtime serves them. A `.guard()` stays local
// at runtime, and so in types
{
	const auth = new Elysia({ as: 'plugin' })
		.derive(() => ({ user: 'alice' as const }))
		.onBeforeHandle(({ headers, status }) => {
			if (!headers.authorization) return status(401, 'nope' as const)
		})
		.onError(({ status }) => status(503, 'down' as const))

	const app = new Elysia().use(auth).get('/', ({ user }) => {
		expectTypeOf(user).toEqualTypeOf<'alice'>()

		return 'ok' as const
	})

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'ok'
		401: 'nope'
		503: 'down'
	}>()

	// a grandparent is past a plugin-scoped hook: unchanged
	const outer = new Elysia().use(new Elysia().use(auth)).get('/', (c) => {
		expectTypeOf(c).not.toHaveProperty('user')

		return 'ok' as const
	})

	// local stays local
	const local = new Elysia({ as: 'local' }).derive(() => ({ x: 1 }))
	new Elysia().use(local).get('/', (c) => {
		expectTypeOf(c).not.toHaveProperty('x')
	})
}
