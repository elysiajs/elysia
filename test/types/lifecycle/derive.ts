import { Elysia } from '../../../src'
import { expectTypeOf } from 'expect-type'

// ? local derive flows into later handler context
{
	new Elysia()
		.derive(() => ({ name: 'hare' as const }))
		.get('/', ({ name }) => {
			expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
		})
}

// ? chained derive accumulates
{
	new Elysia()
		.derive(() => ({ first: 'hare' as const }))
		.derive(() => ({ last: 'omagari' as const }))
		.get('/', ({ first, last }) => {
			expectTypeOf<typeof first>().toEqualTypeOf<'hare'>()
			expectTypeOf<typeof last>().toEqualTypeOf<'omagari'>()
		})
}

// ? local derive does NOT leak to a consumer via .use
{
	const plugin = new Elysia().derive(() => ({ name: 'hare' as const }))

	new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('name')
	})
}

// ? scoped derive propagates exactly one level via .use
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

// ? global derive propagates to every consumer
{
	const plugin = new Elysia().derive({ as: 'global' }, () => ({
		name: 'hare' as const
	}))

	const app = new Elysia().use(plugin).get('/', ({ name }) => {
		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
	})

	new Elysia().use(app).get('/', ({ name }) => {
		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
	})
}

// ? derive can read previously-derived properties
{
	new Elysia()
		.derive(() => ({ a: 1 as const }))
		.derive(({ a }) => {
			expectTypeOf<typeof a>().toEqualTypeOf<1>()
			return { b: 2 as const }
		})
		.get('/', ({ a, b }) => {
			expectTypeOf<typeof a>().toEqualTypeOf<1>()
			expectTypeOf<typeof b>().toEqualTypeOf<2>()
		})
}

export {}
