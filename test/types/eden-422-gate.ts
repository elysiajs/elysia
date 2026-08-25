import { Elysia, t } from '../../src'
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
