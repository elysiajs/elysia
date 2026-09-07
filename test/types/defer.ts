/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'
import type { MaybePromise } from '../../src/types'

import { expectTypeOf } from 'expect-type'

// `context.defer` queues a callback to run after the response is sent. It is
// the context-member form of `afterResponse`, so the callback receives the
// same context the hook would — `responseValue` included.

// Queueing returns nothing to await on the request path.
{
	new Elysia().get('/', ({ defer }) => {
		expectTypeOf(defer(() => {})).toEqualTypeOf<MaybePromise<void>>()

		// the callback's own return is discarded, async or not
		expectTypeOf(defer(async () => 'ignored')).toEqualTypeOf<
			MaybePromise<void>
		>()

		return 'ok' as const
	})
}

// The callback reads the served value through the route's response schema.
{
	new Elysia().get('/', { response: { 200: t.String() } }, ({ defer }) => {
		defer((ctx) => {
			expectTypeOf(ctx.responseValue).toEqualTypeOf<string>()
		})

		return 'ok'
	})
}

// Several declared statuses collapse to the union of what may be served.
{
	new Elysia().get(
		'/',
		{ response: { 200: t.String(), 418: t.Number() } },
		({ defer }) => {
			defer((ctx) => {
				expectTypeOf(ctx.responseValue).toEqualTypeOf<string | number>()
			})

			return 'ok'
		}
	)
}

// Without a response schema nothing is claimed about the served value.
{
	new Elysia().get('/', ({ defer }) => {
		defer((ctx) => {
			expectTypeOf(ctx.responseValue).toEqualTypeOf<unknown>()
		})

		return 'ok' as const
	})
}

// A guard's response schema narrows it the same way a route-local one does.
{
	new Elysia()
		.guard({ response: { 200: t.String() } })
		.get('/', ({ defer }) => {
			defer((ctx) => {
				expectTypeOf(ctx.responseValue).toEqualTypeOf<string>()
			})

			return 'ok'
		})
}

// The callback sees the instance's singleton and the route's own context,
// not a stripped-down one.
{
	new Elysia()
		.decorate('version', 'a' as const)
		.state('counter', 0)
		.derive(() => ({ traceId: 'x' as const }))
		.get('/:id', ({ defer }) => {
			defer((ctx) => {
				expectTypeOf(ctx.version).toEqualTypeOf<'a'>()
				expectTypeOf(ctx.store).toEqualTypeOf<{ counter: number }>()
				expectTypeOf(ctx.traceId).toEqualTypeOf<'x'>()
				expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>()
				expectTypeOf(ctx.request).toEqualTypeOf<Request>()
			})

			return 'ok' as const
		})
}

// `defer` is a context member, so every lifecycle hook can queue one too.
{
	new Elysia().transform(({ defer }) => {
		expectTypeOf(defer(() => {})).toEqualTypeOf<MaybePromise<void>>()
	})

	new Elysia().beforeHandle(({ defer }) => {
		expectTypeOf(defer(() => {})).toEqualTypeOf<MaybePromise<void>>()
	})

	new Elysia().afterHandle(({ defer }) => {
		expectTypeOf(defer(() => {})).toEqualTypeOf<MaybePromise<void>>()
	})

	new Elysia().mapResponse(({ defer }) => {
		expectTypeOf(defer(() => {})).toEqualTypeOf<MaybePromise<void>>()
	})

	new Elysia().error(({ defer }) => {
		expectTypeOf(defer(() => {})).toEqualTypeOf<MaybePromise<void>>()
	})

	// including `afterResponse` itself, which runs on the same queue
	new Elysia().afterResponse(({ defer }) => {
		expectTypeOf(defer(() => {})).toEqualTypeOf<MaybePromise<void>>()
	})
}

// `defer` takes a callback, a value is never scheduled silently.
{
	new Elysia().get('/', ({ defer }) => {
		// @ts-expect-error defer schedules a callback, not a value
		defer(1)

		return 'ok' as const
	})
}
