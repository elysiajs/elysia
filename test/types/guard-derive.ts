import { Elysia, status } from '../../src'
import { expectTypeOf } from 'expect-type'

// A guard's `derive` adds its keys to the routes it guards, and its status to their responses
{
	const app = new Elysia()
		.guard({
			derive: ({ headers }) => {
				const user = headers['x-user']
				if (user === undefined) return status(401, 'sign in first')

				return { user }
			}
		})
		.get('/', ({ user }) => {
			expectTypeOf(user).toEqualTypeOf<string>()

			return user
		})

	expectTypeOf<
		(typeof app)['~Routes']['get']['response'][401]
	>().toEqualTypeOf<'sign in first'>()
}

// Every handler of an array runs, so the route sees all their keys
{
	new Elysia()
		.guard({
			schema: 'merge',
			derive: [() => ({ a: 1 as const }), () => ({ b: 'b' as const })]
		})
		.get('/', ({ a, b }) => {
			expectTypeOf(a).toEqualTypeOf<1>()
			expectTypeOf(b).toEqualTypeOf<'b'>()
		})
}

// A derive that may return nothing adds its keys as optional, like `.derive()`
{
	new Elysia()
		.guard({
			derive: ({ headers }) => {
				if (headers.authorization)
					return { token: headers.authorization }
			}
		})
		.get('/', ({ token }) => {
			expectTypeOf(token).toEqualTypeOf<string | undefined>()
		})
}

// A guard without `derive` adds nothing
{
	new Elysia().guard({ beforeHandle: () => {} }).get('/', (ctx) => {
		expectTypeOf(ctx).not.toHaveProperty('user')
		// @ts-expect-error no index signature from the unused `derive` slot
		ctx.anything
	})
}

// The callback form types the guarded group, and the derive stays inside it
{
	new Elysia()
		.guard({ derive: () => ({ user: 'alice' as const }) }, (app) =>
			app.get('/in', ({ user }) => {
				expectTypeOf(user).toEqualTypeOf<'alice'>()
			})
		)
		.get('/out', (ctx) => {
			expectTypeOf(ctx).not.toHaveProperty('user')
		})
}

// `group` takes the same hook, so its derive types the group's routes
{
	new Elysia()
		.group('/g', { derive: () => ({ user: 'alice' as const }) }, (app) =>
			app.get('/', ({ user }) => {
				expectTypeOf(user).toEqualTypeOf<'alice'>()
			})
		)
		.group(
			'/m',
			{ schema: 'merge', derive: () => ({ user: 'bob' as const }) },
			(app) =>
				app.get('/', ({ user }) => {
					expectTypeOf(user).toEqualTypeOf<'bob'>()
				})
		)
}

// A local guard's derive types its own routes only, a global one every app that uses it
{
	const local = new Elysia()
		.guard('local', { derive: () => ({ user: 'alice' as const }) })
		.get('/', ({ user }) => {
			expectTypeOf(user).toEqualTypeOf<'alice'>()
		})

	new Elysia().use(local).get('/', (ctx) => {
		expectTypeOf(ctx).not.toHaveProperty('user')
	})

	const global = new Elysia().guard('global', {
		schema: 'merge',
		derive: () => ({ user: 'alice' as const })
	})

	new Elysia().use(global).get('/', ({ user }) => {
		expectTypeOf(user).toEqualTypeOf<'alice'>()
	})
}

// A plugin-scoped guard's derive reaches the parent's routes
{
	const plugin = new Elysia().guard('plugin', {
		derive: () => ({ user: 'alice' as const })
	})

	new Elysia().use(plugin).get('/', ({ user }) => {
		expectTypeOf(user).toEqualTypeOf<'alice'>()
	})
}
