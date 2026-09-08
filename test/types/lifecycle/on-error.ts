import { Elysia } from '../../../src'
import { expectTypeOf } from 'expect-type'
import { Prettify } from '../../../src/types'
// I have nothing but my burger and I want nothing more

// Issue #313 — a plain onError body is sent with the thrown error's HTTP
// status (PARSE 400, NOT_FOUND 404, VALIDATION 422, unhandled 500). Eden
// reads those codes as `error`, so the body must not be typed as 200.
{
	const app = new Elysia()
		.onError(() => ({ failure: 'maintenance' as const }))
		.get('/', () => {
			throw new Error('Server is during maintenance')
		})

	type Response = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Response>().toEqualTypeOf<{
		400: { failure: 'maintenance' }
		404: { failure: 'maintenance' }
		422: { failure: 'maintenance' }
		500: { failure: 'maintenance' }
	}>()
}

// Explicit status(...) from onError keeps that status only.
{
	const app = new Elysia()
		.onError(({ status }) => status(418, "I'm a teapot" as const))
		.get('/', () => 'ok' as const)

	type Response = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Response>().toEqualTypeOf<{
		200: 'ok'
		418: "I'm a teapot"
	}>()
}

// Mixed: plain body is under default error statuses; status(404, ...) stays 404.
{
	const app = new Elysia()
		.onError(({ status }) =>
			Math.random() > 0.5
				? status(404, 'not found' as const)
				: { failure: true as const }
		)
		.get('/', () => 'ok' as const)

	type Response = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Response>().toEqualTypeOf<{
		200: 'ok'
		400: { failure: true }
		404: 'not found' | { failure: true }
		422: { failure: true }
		500: { failure: true }
	}>()
}

// status(200, ...) from onError is not remapped onto 4xx/5xx.
{
	const app = new Elysia()
		.onError(({ status }) => status(200, 'recovered' as const))
		.get('/', () => 'ok' as const)

	type Response = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Response>().toEqualTypeOf<{
		200: 'ok' | 'recovered'
	}>()
}

// Scoped / global onError use the same mapping.
{
	const scoped = new Elysia()
		.onError({ as: 'scoped' }, () => ({ scoped: true as const }))
		.get('/', () => 'ok' as const)

	expectTypeOf<
		Prettify<(typeof scoped)['~Routes']['get']['response']>
	>().toEqualTypeOf<{
		200: 'ok'
		400: { scoped: true }
		404: { scoped: true }
		422: { scoped: true }
		500: { scoped: true }
	}>()

	const global = new Elysia()
		.onError({ as: 'global' }, () => ({ global: true as const }))
		.get('/', () => 'ok' as const)

	expectTypeOf<
		Prettify<(typeof global)['~Routes']['get']['response']>
	>().toEqualTypeOf<{
		200: 'ok'
		400: { global: true }
		404: { global: true }
		422: { global: true }
		500: { global: true }
	}>()
}

// Route handlers still type a plain success return as 200.
{
	const app = new Elysia().get('/', () => ({ ok: true as const }))

	expectTypeOf<
		Prettify<(typeof app)['~Routes']['get']['response']>
	>().toEqualTypeOf<{
		200: { ok: true }
	}>()
}
