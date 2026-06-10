import { Elysia } from '../../../src'
import { expectTypeOf } from 'expect-type'

// ? local resolve flows into later handler context
{
	new Elysia()
		.derive(() => ({ token: 'abc' as const }))
		.get('/', ({ token }) => {
			expectTypeOf<typeof token>().toEqualTypeOf<'abc'>()
		})
}

// ? derive + resolve compose
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

// ? local resolve does NOT leak via .use
{
	const plugin = new Elysia().derive(() => ({ token: 'abc' as const }))

	new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('token')
	})
}

// ? scoped resolve propagates one level
{
	const plugin = new Elysia().derive('plugin', () => ({
		token: 'abc' as const
	}))

	new Elysia().use(plugin).get('/', ({ token }) => {
		expectTypeOf<typeof token>().toEqualTypeOf<'abc'>()
	})
}

// ? global resolve propagates everywhere
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
