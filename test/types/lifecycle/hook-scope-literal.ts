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
app.onParse(({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.onParse('local', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.onParse('plugin', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})
app.onParse('global', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})

// transform
app.onTransform(({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.onTransform('local', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.onTransform('plugin', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})
app.onTransform('global', ({ params }) => {
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
app.onAfterResponse(({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.onAfterResponse('local', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<LocalParams>()
})
app.onAfterResponse('plugin', ({ params }) => {
	expectTypeOf(params).toEqualTypeOf<WideParams>()
})
app.onAfterResponse('global', ({ params }) => {
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
app.onParse('scoped', () => {})
