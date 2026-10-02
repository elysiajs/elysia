import { Elysia } from '../../src'
import { expectTypeOf } from 'expect-type'

// Eden's client is built from `~Routes`: one key per path segment

declare const runtime: string

// a path only known as `string` can't be addressed: it adds no route, not an
// index signature that makes every unregistered path type-check
{
	const app = new Elysia()
		.get('/known', () => 'known' as const)
		.get('/runtime/' + runtime, () => 'runtime' as const)
		.ws('/socket/' + runtime, {})
		.mount('/mounted', (request: Request) => new Response('mounted'))

	type Routes = (typeof app)['~Routes']

	expectTypeOf<keyof Routes>().toEqualTypeOf<'known'>()
	expectTypeOf<
		Routes['known']['get']['response'][200]
	>().toEqualTypeOf<'known'>()

	// @ts-expect-error never registered as a typed route
	type Mounted = Routes['mounted']
}

// same under a prefix: its node must not widen
{
	const app = new Elysia({ prefix: '/api' })
		.get('/known', () => 'known' as const)
		.get('/runtime/' + runtime, () => 'runtime' as const)

	expectTypeOf<
		keyof (typeof app)['~Routes']['api']
	>().toEqualTypeOf<'known'>()
}

// an optional param keeps its `:id?` key on every route, so routes under an
// optional prefix land on one key (split `:lang` / `:lang?` breaks Eden)
{
	const app = new Elysia()
		.get('/users/:id/posts', () => 'posts' as const)
		.get('/users/:id?/maybe', () => 'maybe' as const)
		.get('/items/:id', () => 'get' as const)
		.delete('/items/:id?', () => 'delete' as const)

	type Routes = (typeof app)['~Routes']

	expectTypeOf<keyof Routes['users']>().toEqualTypeOf<':id' | ':id?'>()
	expectTypeOf<
		Routes['users'][':id?']['maybe']['get']['response'][200]
	>().toEqualTypeOf<'maybe'>()
	expectTypeOf<keyof Routes['items']>().toEqualTypeOf<':id' | ':id?'>()

	const prefixed = new Elysia({ prefix: '/:lang?' })
		.get('/:id', () => 'id' as const)
		.get('/home', () => 'home' as const)
		.ws('/chat', {})

	type Prefixed = (typeof prefixed)['~Routes']

	expectTypeOf<keyof Prefixed>().toEqualTypeOf<':lang?'>()
	expectTypeOf<keyof Prefixed[':lang?']>().toEqualTypeOf<
		':id' | 'home' | 'chat'
	>()
}
