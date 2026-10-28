import { Elysia, t } from '../../src'
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

// a prefix/group ending in `/` joins a `/`-led path with ONE slash, as the
// router registers it: `/api/` + `/x` is served at `/api/x`, so no `''` node
// (Eden would call `/api//x`, a 404)
{
	const prefixed = new Elysia({ prefix: '/api/' }).get(
		'/x',
		() => 'x' as const
	)
	expectTypeOf<keyof (typeof prefixed)['~Routes']>().toEqualTypeOf<'api'>()
	expectTypeOf<
		keyof (typeof prefixed)['~Routes']['api']
	>().toEqualTypeOf<'x'>()

	const root = new Elysia({ prefix: '/' }).get('/x', () => 'x' as const)
	expectTypeOf<keyof (typeof root)['~Routes']>().toEqualTypeOf<'x'>()

	const group = new Elysia()
		.group('/', (g) => g.get('/x', () => 'x' as const))
		.group('/g/', (g) => g.get('/y', () => 'y' as const))
	type Group = (typeof group)['~Routes']
	expectTypeOf<keyof Group>().toEqualTypeOf<'x' | 'g'>()
	expectTypeOf<keyof Group['g']>().toEqualTypeOf<'y'>()

	// an empty path is the group itself, a slash-less path after a trailing
	// slash adds none (`/d/` + `e` is `/d/e`), a route's own trailing slash is
	// not a node
	const kept = new Elysia()
		.group('/c', (g) => g.get('', () => 'c' as const))
		.group('/d/', (g) => g.get('e', () => 'e' as const))
		.get('/t/', () => 't' as const)
	type Kept = (typeof kept)['~Routes']
	expectTypeOf<keyof Kept>().toEqualTypeOf<'c' | 'd' | 't'>()
	expectTypeOf<Kept['c']['get']['response'][200]>().toEqualTypeOf<'c'>()
	expectTypeOf<keyof Kept['d']>().toEqualTypeOf<'e'>()
	expectTypeOf<Kept['t']['get']['response'][200]>().toEqualTypeOf<'t'>()
}

// `.route(method)` registers the method uppercased, so `.route('GET')` is the
// same route as `.get()`: one lowercase method key, as `.get()` has
{
	const app = new Elysia()
		.route('GET', '/r', () => 'r' as const)
		.route('propfind', '/p', () => 'p' as const)
		.route('PURGE', '/h', { beforeHandle() {} }, () => 'h' as const)
	type Routes = (typeof app)['~Routes']

	expectTypeOf<keyof Routes['r']>().toEqualTypeOf<'get'>()
	expectTypeOf<Routes['r']['get']['response'][200]>().toEqualTypeOf<'r'>()
	expectTypeOf<keyof Routes['p']>().toEqualTypeOf<'propfind'>()
	expectTypeOf<keyof Routes['h']>().toEqualTypeOf<'purge'>()

	// @ts-expect-error never an uppercase key
	type Upper = Routes['r']['GET']

	// a union method is every one of them, lowercased
	const union = new Elysia().route(
		'PUT' as 'PUT' | 'PATCH',
		'/u',
		() => 'u' as const
	)
	expectTypeOf<keyof (typeof union)['~Routes']['u']>().toEqualTypeOf<
		'put' | 'patch'
	>()
}

// A used plugin's routes are served under the parent's prefix or group, so
// the router resolves its params for them (`/t/acme/p` -> `{ tenant: 'acme' }`)
// and Eden must send them: the prefix params are on every used route
{
	const plugin = new Elysia()
		.get('/p', () => 'p' as const)
		.get('/n/:id', () => 'n' as const)
		.ws('/w', {})

	const viaPrefix = new Elysia({ prefix: '/t/:tenant' }).use(plugin)
	type Prefixed = (typeof viaPrefix)['~Routes']['t'][':tenant']

	expectTypeOf<Prefixed['p']['get']['params']>().toEqualTypeOf<{
		tenant: string
	}>()
	expectTypeOf<Prefixed['n'][':id']['get']['params']>().toEqualTypeOf<{
		tenant: string
		id: string
	}>()
	expectTypeOf<Prefixed['w']['subscribe']['params']>().toEqualTypeOf<{
		tenant: string
	}>()

	const viaGroup = new Elysia().group('/g/:tenant', (g) =>
		g.use(plugin).use([plugin])
	)
	expectTypeOf<
		(typeof viaGroup)['~Routes']['g'][':tenant']['p']['get']['params']
	>().toEqualTypeOf<{ tenant: string }>()

	// a prefix without params leaves the used routes as they are
	const plain = new Elysia({ prefix: '/api' }).use(plugin)
	expectTypeOf<
		(typeof plain)['~Routes']['api']['n'][':id']['get']['params']
	>().toEqualTypeOf<(typeof plugin)['~Routes']['n'][':id']['get']['params']>()
}

// the used route's own params schema wins a key the prefix also has: it is
// what validates and decodes it (`/123/child` -> `{ id: 123 }`), not `never`
{
	const plugin = new Elysia().get(
		'/child',
		{ params: t.Object({ id: t.Numeric() }) },
		({ params }) => params.id
	)
	const app = new Elysia({ prefix: '/:id/:org' }).use(plugin)

	expectTypeOf<
		(typeof app)['~Routes'][':id'][':org']['child']['get']['params']
	>().toEqualTypeOf<{ org: string; id: number }>()
}

// Registering a method at a path again replaces it: the router serves the
// later handler, so its response is the route's, not the `never` that
// intersecting both would make. Other methods and siblings stay
{
	const app = new Elysia()
		.get('/a', () => 'first' as const)
		.post('/a', () => 'post' as const)
		.get('/a/b', () => 'nested' as const)
		.get('/a', () => 'second' as const)
		.get('/', () => 'root' as const)
		.get('/', () => 'root2' as const)

	type Routes = (typeof app)['~Routes']

	expectTypeOf<
		Routes['a']['get']['response'][200]
	>().toEqualTypeOf<'second'>()
	expectTypeOf<Routes['a']['post']['response'][200]>().toEqualTypeOf<'post'>()
	expectTypeOf<
		Routes['a']['b']['get']['response'][200]
	>().toEqualTypeOf<'nested'>()
	expectTypeOf<Routes['get']['response'][200]>().toEqualTypeOf<'root2'>()
}
