import { Elysia } from '../../src'
import { expectTypeOf } from 'expect-type'

// Object-form macro meta surfaces on the route's Eden type.
// `.macro()` captures the definition const, so literals survive
// without `as const`.
{
	const app = new Elysia()
		.macro({
			live: {
				meta: { live: true },
				beforeHandle: () => {}
			}
		})
		.get('/todos', { live: true }, () => 'ok')

	expectTypeOf<
		(typeof app)['~Routes']['todos']['get']['meta']
	>().toEqualTypeOf<{ readonly live: true }>()
}

// Fn-form macro meta resolves to the macro's DECLARED return meta type.
// Call-site literal narrowing is not supported (the macro generic is
// never instantiated from the route's value).
{
	const app = new Elysia()
		.macro({
			live: (enabled: boolean) => ({
				meta: { live: true } as const,
				beforeHandle: () => {}
			})
		})
		.get('/todos', { live: true }, () => 'ok')

	expectTypeOf<
		(typeof app)['~Routes']['todos']['get']['meta']
	>().toEqualTypeOf<{ readonly live: true }>()
}

// Fn-form macro returning `X | undefined` keeps its meta (NonNullable).
{
	const app = new Elysia()
		.macro({
			maybe: (v: boolean) =>
				v ? { meta: { maybe: true } as const } : undefined
		})
		.get('/x', { maybe: true }, () => 'ok')

	expectTypeOf<
		(typeof app)['~Routes']['x']['get']['meta']
	>().toEqualTypeOf<{ readonly maybe: true }>()
}

// Two meta-bearing macros on one route intersect their metas.
{
	const app = new Elysia()
		.macro({
			live: {
				meta: { live: true },
				beforeHandle: () => {}
			},
			audit: {
				meta: { audit: 'v1' },
				beforeHandle: () => {}
			}
		})
		.get('/w', { live: true, audit: true }, () => 'ok')

	expectTypeOf<
		(typeof app)['~Routes']['w']['get']['meta']
	>().toEqualTypeOf<{ readonly live: true } & { readonly audit: 'v1' }>()
}

// A macro that declares NO meta must NOT leak a `meta` key onto the route.
// Regression case: UnionToIntersect<never> is `unknown`, which must be
// filtered by CreateEdenResponse, not surfaced.
{
	const app = new Elysia()
		.macro({
			auth: {
				beforeHandle: () => {}
			}
		})
		.get('/x', { auth: true }, () => 'ok')

	type Route = (typeof app)['~Routes']['x']['get']

	expectTypeOf<
		'meta' extends keyof Route ? true : false
	>().toEqualTypeOf<false>()
}

// A plain route on a macro-less app has no `meta` key.
{
	const app = new Elysia().get('/x', () => 'ok')

	type Route = (typeof app)['~Routes']['x']['get']

	expectTypeOf<
		'meta' extends keyof Route ? true : false
	>().toEqualTypeOf<false>()
}

// A route that enables no macro on a macro-carrying app has no `meta` key.
{
	const app = new Elysia()
		.macro({
			live: {
				meta: { live: true },
				beforeHandle: () => {}
			}
		})
		.get('/x', () => 'ok')

	type Route = (typeof app)['~Routes']['x']['get']

	expectTypeOf<
		'meta' extends keyof Route ? true : false
	>().toEqualTypeOf<false>()
}

// Meta survives the WS route path (CreateWSEdenResponse's Omit).
{
	const app = new Elysia()
		.macro({
			live: {
				meta: { live: true },
				beforeHandle: () => {}
			}
		})
		.ws('/ws', {
			live: true,
			message: () => {}
		})

	expectTypeOf<
		(typeof app)['~Routes']['ws']['subscribe']['meta']
	>().toEqualTypeOf<{ readonly live: true }>()
}

// Sibling recursion: a macro enabling another macro composes both metas.
{
	const app = new Elysia()
		.macro({
			inner: {
				meta: { inner: 1 },
				beforeHandle: () => {}
			},
			outer: {
				meta: { outer: 2 },
				inner: true,
				beforeHandle: () => {}
			}
		})
		.get('/x', { outer: true }, () => 'ok')

	expectTypeOf<
		(typeof app)['~Routes']['x']['get']['meta']
	>().toEqualTypeOf<{ readonly outer: 2 } & { readonly inner: 1 }>()
}
