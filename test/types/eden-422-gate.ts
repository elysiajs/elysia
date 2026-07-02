import { Elysia, t } from '../../src'

// M33: a parametric route WITHOUT validators has no validation step at
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
