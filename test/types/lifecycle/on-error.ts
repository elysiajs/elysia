import { Elysia, status } from '../../../src'
import { expectTypeOf } from 'expect-type'
import type { Prettify, ErrorHandler } from '../../../src/types'

// Issue #313: plain onError return is typed under error statuses (400, 404, 422, 500)
// and not under 200, so Eden clients type error.value correctly without polluting data.
{
	const app = new Elysia()
		.onError(() => ({ failure: 'maintenance' as const }))
		.get('/', () => 'ok' as const)

	type RouteResponse = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<RouteResponse>().toEqualTypeOf<{
		200: 'ok'
		400: { failure: 'maintenance' }
		404: { failure: 'maintenance' }
		422: { failure: 'maintenance' }
		500: { failure: 'maintenance' }
	}>()
}

// Conditional onError return (union with undefined) correctly preserves the error body
// rather than collapsing into {}
{
	const app = new Elysia()
		.onError(({ code, error }) => {
			if (code === 'VALIDATION') {
				return { failure: error.message }
			}
		})
		.get('/', () => 'hello' as const)

	type RouteResponse = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<RouteResponse>().toEqualTypeOf<{
		200: 'hello'
		400: { failure: string }
		404: { failure: string }
		422: { failure: string }
		500: { failure: string }
	}>()
}

// Explicit status(code, value) preserves exact code without defaulting to 400/404/422/500
{
	const app = new Elysia()
		.onError(() => status(418, 'teapot' as const))
		.get('/', () => 'tea' as const)

	type RouteResponse = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<RouteResponse>().toEqualTypeOf<{
		200: 'tea'
		418: 'teapot'
	}>()
}

// Async onError handler resolves return type correctly
{
	const app = new Elysia()
		.onError(async () => ({ asyncError: true as const }))
		.get('/', () => 'async' as const)

	type RouteResponse = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<RouteResponse>().toEqualTypeOf<{
		200: 'async'
		400: { asyncError: true }
		404: { asyncError: true }
		422: { asyncError: true }
		500: { asyncError: true }
	}>()
}

// Array of onError handlers unions the error response schemas
{
	const app = new Elysia()
		.onError([
			() => ({ errorA: 1 as const }),
			() => ({ errorB: 2 as const })
		])
		.get('/', () => 'array' as const)

	type RouteResponse = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<RouteResponse>().toEqualTypeOf<{
		200: 'array'
		400: { errorA: 1 } | { errorB: 2 }
		404: { errorA: 1 } | { errorB: 2 }
		422: { errorA: 1 } | { errorB: 2 }
		500: { errorA: 1 } | { errorB: 2 }
	}>()
}

// Guard error handlers map to error statuses
{
	const app = new Elysia().guard({
		error: () => ({ guardError: true as const })
	})

	type GuardResponse = Prettify<(typeof app)['~Volatile']['response']>

	expectTypeOf<GuardResponse>().toEqualTypeOf<{
		400: { guardError: true }
		404: { guardError: true }
		422: { guardError: true }
		500: { guardError: true }
	}>()
}

// Macro error handlers map to error statuses
{
	const app = new Elysia()
		.macro({
			customAuth: {
				error() {
					return { macroError: 'unauthorized' as const }
				}
			}
		})
		.get('/', () => 'ok' as const, {
			customAuth: true
		})

	type RouteResponse = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<RouteResponse>().toEqualTypeOf<{
		200: 'ok'
		400: { macroError: 'unauthorized' }
		404: { macroError: 'unauthorized' }
		422: { macroError: 'unauthorized' }
		500: { macroError: 'unauthorized' }
	}>()
}

// Eden Treaty client error type inference contract verification
{
	const app = new Elysia()
		.onError(() => ({ failure: 'maintenance' as const }))
		.get('/', () => 'ok' as const)

	type RouteResponse = (typeof app)['~Routes']['get']['response']

	// Simulating TreatyResponse error mapping:
	type TreatyError<Res> = {
		[Status in Exclude<
			keyof Res,
			200 | 201 | 204 | 206
		>]: Res[Status] extends infer Value
			? {
					status: Status
					value: Value
				}
			: never
	}[Exclude<keyof Res, 200 | 201 | 204 | 206>]

	type ErrorType = TreatyError<RouteResponse>

	// error.value is strictly typed as { failure: 'maintenance' }
	expectTypeOf<ErrorType['value']>().toEqualTypeOf<{
		failure: 'maintenance'
	}>()

	// data only contains 'ok', not the failure object
	type TreatyData<Res> = Res extends { 200: infer D } ? D : never
	expectTypeOf<TreatyData<RouteResponse>>().toEqualTypeOf<'ok'>()
}

// Explicitly typed ErrorHandler does not produce broad 200 or [x: number] schema
{
	const handler: ErrorHandler = () => {}
	const app = new Elysia()
		.onError(handler)
		.get('/', () => 'ok' as const)

	type AppResponse = (typeof app)['~Routes']['get']['response']
	expectTypeOf<AppResponse>().toEqualTypeOf<{
		200: 'ok'
	}>()
}

