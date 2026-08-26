import { Elysia } from '../../../src'
import { expectTypeOf } from 'expect-type'
import { Prettify } from '../../../src/types'

// A plain value returned from onError becomes the body of the runtime
// error status instead of being recorded as a 200 response
{
	const app = new Elysia()
		.onError(() => ({ failure: true }))
		.get('/', () => 'ok')

	type Response = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Response>().toEqualTypeOf<{
		200: string
		400: { failure: boolean }
		404: { failure: boolean }
		422: { failure: boolean }
		500: { failure: boolean }
	}>()
}

// An explicit status(code, value) returned from onError keeps its exact
// status and is not duplicated across default error statuses
{
	const app = new Elysia()
		.onError(({ status }) => status(418, "I'm a teapot"))
		.get('/', () => 'ok')

	type Response = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Response>().toEqualTypeOf<{
		200: string
		418: "I'm a teapot"
	}>()
}

// Mixed explicit statuses and plain returns are unioned per status
{
	const app = new Elysia()
		.onError(({ status }) =>
			Math.random() > 0.5 ? status(404, 'not found') : { failure: true }
		)
		.get('/', () => 'ok')

	type Response = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Response>().toEqualTypeOf<{
		200: string
		400: { failure: boolean }
		404: 'not found' | { failure: boolean }
		422: { failure: boolean }
		500: { failure: boolean }
	}>()
}
