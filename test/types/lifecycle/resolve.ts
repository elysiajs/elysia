import { Elysia } from '../../../src'
import { expectTypeOf } from 'expect-type'

// Local derived values reach later handlers on the same instance.
{
	new Elysia()
		.derive(() => ({ token: 'abc' as const }))
		.get('/', ({ token }) => {
			expectTypeOf<typeof token>().toEqualTypeOf<'abc'>()
		})
}

// Chained derivations compose their values.
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

// Local derived values do not reach plugin consumers.
{
	const plugin = new Elysia().derive(() => ({ token: 'abc' as const }))

	new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('token')
	})
}

// Plugin-scoped derived values reach one consumer.
{
	const plugin = new Elysia().derive('plugin', () => ({
		token: 'abc' as const
	}))

	new Elysia().use(plugin).get('/', ({ token }) => {
		expectTypeOf<typeof token>().toEqualTypeOf<'abc'>()
	})
}

// Global derived values reach nested consumers.
{
	const plugin = new Elysia().derive('global', () => ({
		token: 'abc' as const
	}))

	const app = new Elysia().use(plugin)

	new Elysia().use(app).get('/', ({ token }) => {
		expectTypeOf<typeof token>().toEqualTypeOf<'abc'>()
	})
}

export {}
