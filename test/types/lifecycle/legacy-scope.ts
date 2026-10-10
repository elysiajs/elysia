import { Elysia } from '../../../src'
import { expectTypeOf } from 'expect-type'

// 1.x `{ as }` hook options type through a deprecated overload that maps
// `'scoped'` to `'plugin'`; typed as local, a 1.x plugin's derived value
// would vanish from the routes of the app that uses it

// `{ as: 'scoped' }` derived values reach exactly one consumer.
{
	const plugin = new Elysia().derive({ as: 'scoped' }, () => ({
		name: 'hare' as const
	}))

	const app = new Elysia().use(plugin).get('/', ({ name }) => {
		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
	})

	new Elysia().use(app).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('name')
	})
}

// `{ as: 'global' }` derived values reach every nested consumer.
{
	const plugin = new Elysia().mapDerive({ as: 'global' }, () => ({
		name: 'hare' as const
	}))

	const app = new Elysia().use(plugin)

	new Elysia().use(app).get('/', ({ name }) => {
		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
	})
}

// `{ as: 'local' }` derived values stay on the declaring instance.
{
	const plugin = new Elysia().derive({ as: 'local' }, () => ({
		name: 'hare' as const
	}))

	plugin.get('/', ({ name }) => {
		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
	})

	new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('name')
	})
}

// A non-local hook runs on routes whose path it cannot know, so its params
// widen exactly as with the 2.0 scope argument.
{
	const app = new Elysia({ prefix: '/:id' })

	app.onBeforeHandle({ as: 'scoped' }, ({ params }) => {
		expectTypeOf(params).toEqualTypeOf<{
			[name: string]: string | undefined
		}>()
	})
	app.onTransform({ as: 'local' }, ({ params }) => {
		expectTypeOf(params).toEqualTypeOf<{ id: string }>()
	})
}

// The unprefixed 2.0-beta names are gone.
{
	const app = new Elysia()

	// @ts-expect-error renamed to onRequest
	app.request(() => {})
	// @ts-expect-error renamed to onParse
	app.parse(() => {})
	// @ts-expect-error renamed to onTransform
	app.transform(() => {})
	// @ts-expect-error renamed to onBeforeHandle
	app.beforeHandle(() => {})
	// @ts-expect-error renamed to onAfterHandle
	app.afterHandle(() => {})
	// @ts-expect-error renamed to onAfterResponse
	app.afterResponse(() => {})
	// @ts-expect-error renamed to onError
	app.error(() => {})
	// @ts-expect-error renamed to onStart
	app.setup(() => {})
	// @ts-expect-error renamed to onStop
	app.cleanup(() => {})
}

export {}
