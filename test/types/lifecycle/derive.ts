import { Elysia } from '../../../src'
import { expectTypeOf } from 'expect-type'

// Local derived values reach later handlers on the same instance.
{
	new Elysia()
		.derive(() => ({ name: 'hare' as const }))
		.get('/', ({ name }) => {
			expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
		})
}

// Chained derivations accumulate their values.
{
	new Elysia()
		.derive(() => ({ first: 'hare' as const }))
		.derive(() => ({ last: 'omagari' as const }))
		.get('/', ({ first, last }) => {
			expectTypeOf<typeof first>().toEqualTypeOf<'hare'>()
			expectTypeOf<typeof last>().toEqualTypeOf<'omagari'>()
		})
}

// Local derived values do not reach plugin consumers.
{
	const plugin = new Elysia().derive(() => ({ name: 'hare' as const }))

	new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('name')
	})
}

// Plugin-scoped derived values reach exactly one consumer.
{
	const plugin = new Elysia().derive('plugin', () => ({
		name: 'hare' as const
	}))

	const app = new Elysia().use(plugin).get('/', ({ name }) => {
		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
	})

	new Elysia().use(app).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('name')
	})
}

// Global derived values reach every nested consumer.
{
	const plugin = new Elysia().derive('global', () => ({
		name: 'hare' as const
	}))

	const app = new Elysia().use(plugin).get('/', ({ name }) => {
		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
	})

	new Elysia().use(app).get('/', ({ name }) => {
		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
	})
}

// A derivation can read previously derived values.
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
