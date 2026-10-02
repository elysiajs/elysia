import { Elysia } from '../../../src'
import { trace } from '../../../src/plugin/trace'
import { expectTypeOf } from 'expect-type'

// parse/transform/mapResponse/afterResponse/trace have no per-literal scope
// overloads: a literal scope argument must resolve through the generic
// `<const HookScope extends EventScope>` overload to the same context the
// removed 'local' | 'plugin' | 'global' overloads produced. 'local' keeps the
// route params, 'plugin' / 'global' widen them (the hook runs on routes whose
// path it cannot know).
type LocalParams = { id: string }
type WideParams = { [name: string]: string | undefined }

const app = new Elysia({ prefix: '/:id' })

// parse
app.parse(({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.parse('local', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.parse('plugin', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})
app.parse('global', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})

// transform
app.transform(({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.transform('local', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.transform('plugin', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})
app.transform('global', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})

// mapResponse
app.mapResponse(({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.mapResponse('local', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.mapResponse('plugin', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})
app.mapResponse('global', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})

// afterResponse
app.afterResponse(({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.afterResponse('local', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.afterResponse('plugin', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})
app.afterResponse('global', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})

// trace: every literal scope is accepted, a non-scope string is not
const traced = new Elysia().use(trace())
traced.trace('local', () => {})
traced.trace('plugin', () => {})
traced.trace('global', () => {})
// @ts-expect-error not an EventScope
traced.trace('scoped', () => {})
// @ts-expect-error not an EventScope
app.parse('scoped', () => {})
