import { Elysia, t } from '../../src'
import { expectTypeOf } from 'expect-type'

// a parametric route WITHOUT validators has no validation step at
// runtime — its Eden response union must not advertise a phantom 422.

// parametric, no validators — must NOT have 422
const a = new Elysia().get('/id/:id', ({ params }) => params.id)
type A = (typeof a)['~Routes']['id'][':id']['get']['response']
declare const checkA: A
// @ts-expect-error phantom 422 must be gone
checkA[422]

// parametric WITH a real coercing validator — 422 must remain
const b = new Elysia().get(
	'/n/:id',
	{ params: t.Object({ id: t.Number() }) },
	({ params }) => params.id
)
type B = (typeof b)['~Routes']['n'][':id']['get']['response']
declare const checkB: B
checkB[422].type satisfies 'validation'

// non-parametric with a query validator — 422 must remain
const c = new Elysia().get(
	'/q',
	{ query: t.Object({ x: t.String() }) },
	({ query }) => query.x
)
type C = (typeof c)['~Routes']['q']['get']['response']
declare const checkC: C
checkC[422].type satisfies 'validation'

// eden-types-1: a `response` schema is an OUTPUT schema and can never trigger a
// request-time 422. A route that declares ONLY a `response` schema (no
// body/query/headers/cookie/params validator) must NOT advertise a phantom 422,
// otherwise every Eden consumer is told to handle a status the runtime never
// emits. `response` was wrongly kept in the `HasInputValidator` probe.

// response-only — must NOT have 422, and its record must be exactly { 200: string }
const respOnly = new Elysia().get(
	'/only-response',
	{ response: { 200: t.String() } },
	() => 'ok'
)
type RespOnly = (typeof respOnly)['~Routes']['only-response']['get']['response']
declare const checkRespOnly: RespOnly
// @ts-expect-error phantom 422 must be gone for a response-only route
checkRespOnly[422]
// full-record equality: the resolved Eden response tree is exactly { 200: string }
expectTypeOf<RespOnly>().toEqualTypeOf<{ 200: string }>()

// response + body — 422 must remain (load-bearing non-regression: excluding
// `response` from the probe must not suppress a real body validator's 422)
const respAndBody = new Elysia().post(
	'/response-and-body',
	{ body: t.Object({ n: t.Number() }), response: { 200: t.String() } },
	() => 'ok'
)
type RespAndBody =
	(typeof respAndBody)['~Routes']['response-and-body']['post']['response']
declare const checkRespAndBody: RespAndBody
checkRespAndBody[422].type satisfies 'validation'

// headers-only validator — 422 must remain
const hdrOnly = new Elysia().get(
	'/h',
	{ headers: t.Object({ 'x-token': t.String() }) },
	() => 'ok'
)
type HdrOnly = (typeof hdrOnly)['~Routes']['h']['get']['response']
declare const checkHdrOnly: HdrOnly
checkHdrOnly[422].type satisfies 'validation'

// cookie-only validator — 422 must remain
const ckOnly = new Elysia().get(
	'/c',
	{ cookie: t.Object({ session: t.String() }) },
	() => 'ok'
)
type CkOnly = (typeof ckOnly)['~Routes']['c']['get']['response']
declare const checkCkOnly: CkOnly
checkCkOnly[422].type satisfies 'validation'

// WS response-only — must NOT have 422 (same root cause propagates via
// CreateWSEdenResponse -> ComposeElysiaResponse)
const wsRespOnly = new Elysia().ws('/notify', {
	response: t.Object({ n: t.Number() }),
	message(ws) {}
})
type WSRespOnly =
	(typeof wsRespOnly)['~Routes']['notify']['subscribe']['response']
declare const checkWSRespOnly: WSRespOnly
// @ts-expect-error phantom 422 must be gone for a WS response-only route
checkWSRespOnly[422]
