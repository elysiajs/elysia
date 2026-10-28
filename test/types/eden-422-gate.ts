import {
	Elysia,
	t,
	type UnwrapRoute,
	type ValidationErrorResponse
} from '../../src'
import { expectTypeOf } from 'expect-type'

// Path parameters alone do not add a validator, so Eden must omit 422.

// A path parameter without a schema has no validation response.
const a = new Elysia().get('/id/:id', ({ params }) => params.id)
type A = (typeof a)['~Routes']['id'][':id']['get']['response']
declare const checkA: A
// @ts-expect-error no request validator can produce 422
checkA[422]

// A path parameter schema adds a validation response.
const b = new Elysia().get(
	'/n/:id',
	{ params: t.Object({ id: t.Number() }) },
	({ params }) => params.id
)
type B = (typeof b)['~Routes']['n'][':id']['get']['response']
declare const checkB: B
checkB[422].type satisfies 'validation'

// That 422 is the exported document member for member, though the route
// spells it out so a consumer's d.ts prints it inline
expectTypeOf<B[422]>().toEqualTypeOf<ValidationErrorResponse>()

// A query schema adds a validation response.
const c = new Elysia().get(
	'/q',
	{ query: t.Object({ x: t.String() }) },
	({ query }) => query.x
)
type C = (typeof c)['~Routes']['q']['get']['response']
declare const checkC: C
checkC[422].type satisfies 'validation'

// Response schemas describe output and do not add a request-time 422.

// A response-only route exposes only its declared response.
const respOnly = new Elysia().get(
	'/only-response',
	{ response: { 200: t.String() } },
	() => 'ok'
)
type RespOnly = (typeof respOnly)['~Routes']['only-response']['get']['response']
declare const checkRespOnly: RespOnly
// @ts-expect-error response schemas do not produce request validation errors
checkRespOnly[422]
expectTypeOf<RespOnly>().toEqualTypeOf<{ 200: string }>()

// A body validator still adds 422 when a response schema is also present.
const respAndBody = new Elysia().post(
	'/response-and-body',
	{ body: t.Object({ n: t.Number() }), response: { 200: t.String() } },
	() => 'ok'
)
type RespAndBody =
	(typeof respAndBody)['~Routes']['response-and-body']['post']['response']
declare const checkRespAndBody: RespAndBody
checkRespAndBody[422].type satisfies 'validation'

// A headers schema adds a validation response.
const hdrOnly = new Elysia().get(
	'/h',
	{ headers: t.Object({ 'x-token': t.String() }) },
	() => 'ok'
)
type HdrOnly = (typeof hdrOnly)['~Routes']['h']['get']['response']
declare const checkHdrOnly: HdrOnly
checkHdrOnly[422].type satisfies 'validation'

// A cookie schema adds a validation response.
const ckOnly = new Elysia().get(
	'/c',
	{ cookie: t.Object({ session: t.String() }) },
	() => 'ok'
)
type CkOnly = (typeof ckOnly)['~Routes']['c']['get']['response']
declare const checkCkOnly: CkOnly
checkCkOnly[422].type satisfies 'validation'

// A WebSocket response schema does not add 422 either.
const wsRespOnly = new Elysia().ws('/notify', {
	response: t.Object({ n: t.Number() }),
	message(ws) {}
})
type WSRespOnly =
	(typeof wsRespOnly)['~Routes']['notify']['subscribe']['response']
declare const checkWSRespOnly: WSRespOnly
// @ts-expect-error WebSocket response schemas do not validate inbound data
checkWSRespOnly[422]

// A param from the prefix or group is still only a path param: the route
// is served at the joined path, which validates nothing, so no 422
const viaPrefix = new Elysia({ prefix: '/u/:uid' }).get(
	'/x',
	({ params }) => params.uid
)
type ViaPrefix = (typeof viaPrefix)['~Routes']['u'][':uid']['x']['get']
expectTypeOf<ViaPrefix['response']>().toEqualTypeOf<{ 200: string }>()
expectTypeOf<ViaPrefix['params']['uid']>().toBeString()

const viaGroup = new Elysia().group('/g/:gid', (g) =>
	g.get('/x', ({ params }) => params.gid)
)
expectTypeOf<
	(typeof viaGroup)['~Routes']['g'][':gid']['x']['get']['response']
>().toEqualTypeOf<{ 200: string }>()

// ...while a params schema under that prefix still validates
const viaPrefixSchema = new Elysia({ prefix: '/u/:uid' }).get(
	'/x',
	{ params: t.Object({ uid: t.Number() }) },
	({ params }) => params.uid
)
expectTypeOf<
	(typeof viaPrefixSchema)['~Routes']['u'][':uid']['x']['get']['response']
>().toEqualTypeOf<{ 200: number; 422: ValidationErrorResponse }>()

// A refined params schema types the same as the path-derived params, but its
// validator runs and rejects `/p/ab` with 422: presence decides, not shape
const refined = new Elysia().get(
	'/p/:id',
	{ params: t.Object({ id: t.String({ minLength: 5 }) }) },
	({ params }) => params.id
)
expectTypeOf<
	(typeof refined)['~Routes']['p'][':id']['get']['response']
>().toEqualTypeOf<{ 200: string; 422: ValidationErrorResponse }>()

// the same from a guard
const refinedGuard = new Elysia()
	.guard({ params: t.Object({ id: t.String({ format: 'uuid' }) }) })
	.get('/p/:id', ({ params }) => params.id)
expectTypeOf<
	(typeof refinedGuard)['~Routes']['p'][':id']['get']['response']
>().toEqualTypeOf<{ 200: string; 422: ValidationErrorResponse }>()

// `'~validates'` is internal provenance, optional on the exported `UnwrapRoute`:
// a value built or annotated without it still fits
{
	const params = t.Object({ id: t.String() })
	type Route = UnwrapRoute<{ params: typeof params }>
	const handBuilt = null! as Omit<Route, '~validates'>
	const asRoute: Route = handBuilt
	const empty: UnwrapRoute<{}> = null! as Omit<UnwrapRoute<{}>, '~validates'>
}

// A parent's guard (or group) schema validates the routes of a plugin it
// `.use()`s too (`/plug` without `?token` is a 422): Eden must send its input,
// and the 422 is possible. A field the plugin route declares itself wins, as
// the runtime overrides it; a `schema: 'merge'` guard always applies. A guard
// registered after the `.use()` doesn't reach the plugin's routes
{
	const plugin = new Elysia()
		.get('/plug', () => 'plug' as const)
		.get(
			'/own',
			{ query: t.Object({ a: t.String() }) },
			() => 'own' as const
		)

	const local = new Elysia()
		.guard({ query: t.Object({ token: t.String() }) })
		.use(plugin)
	type Local = (typeof local)['~Routes']

	expectTypeOf<Local['plug']['get']['query']>().toEqualTypeOf<{
		token: string
	}>()
	expectTypeOf<Local['plug']['get']['response']>().toEqualTypeOf<{
		200: 'plug'
		422: ValidationErrorResponse
	}>()
	expectTypeOf<Local['own']['get']['query']>().toEqualTypeOf<{ a: string }>()

	const group = new Elysia().group(
		'/g',
		{ headers: t.Object({ authorization: t.String() }) },
		(g) => g.use(plugin)
	)
	expectTypeOf<
		(typeof group)['~Routes']['g']['plug']['get']['headers']
	>().toEqualTypeOf<{ authorization: string }>()

	const merged = new Elysia()
		.guard({ schema: 'merge', query: t.Object({ token: t.String() }) })
		.use(plugin)
	expectTypeOf<
		(typeof merged)['~Routes']['own']['get']['query']
	>().toEqualTypeOf<{ a: string } & { token: string }>()

	const after = new Elysia()
		.use(plugin)
		.guard({ query: t.Object({ token: t.String() }) })
	expectTypeOf<
		(typeof after)['~Routes']['plug']['get']['response']
	>().toEqualTypeOf<{ 200: 'plug' }>()

	// a guard that validates nothing leaves the used routes as they are
	const hookOnly = new Elysia().guard({ beforeHandle() {} }).use(plugin)
	expectTypeOf<
		(typeof hookOnly)['~Routes']['plug']['get']['response']
	>().toEqualTypeOf<{ 200: 'plug' }>()
}
