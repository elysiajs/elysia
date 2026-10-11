import { Elysia } from '../../src'
import { trace, type TraceEvent } from '../../src/plugin/trace'
import { expectTypeOf } from 'expect-type'

// The per-request id is on the trace lifecycle and on every process a listener
// receives (the begin process and its `onEvent` children), so a trace callback
// can correlate a span with its request without reaching back to the lifecycle.
// Each process also names the lifecycle `event` it belongs to
new Elysia().use(trace()).trace(({ id, onRequest, onHandle, onError }) => {
	expectTypeOf(id).toEqualTypeOf<string>()

	onRequest((event) => {
		expectTypeOf(event.id).toEqualTypeOf<string>()
		expectTypeOf(event.event).toEqualTypeOf<TraceEvent>()

		event.onEvent((child) => {
			expectTypeOf(child.id).toEqualTypeOf<string>()
			expectTypeOf(child.event).toEqualTypeOf<TraceEvent>()

			// @ts-expect-error a child process carries no property named `requestId`
			child.requestId
		})
	})

	onHandle(async (event) => {
		expectTypeOf(event.id).toEqualTypeOf<string>()

		// @ts-expect-error the process has `id`, not `requestId`
		event.requestId

		// @ts-expect-error `event` is a lifecycle event, not any string
		const _unknownEvent: typeof event.event = 'notAnEvent'

		await event.onStop((detail) => {
			// the end detail is a timing summary, not a process: it has no id
			// @ts-expect-error `id` is not part of the end detail
			detail.id

			// @ts-expect-error `event` is not part of the end detail
			detail.event
		})
	})

	onError((event) => {
		expectTypeOf(event.id).toEqualTypeOf<string>()
	})
})
