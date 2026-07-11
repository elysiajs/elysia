import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

// These tests pin the abort short-circuit guard in buildFetchHandler (src/handler/fetch.ts).
// The guard fires on `request.signal.aborted` early in each fetch-handler variant,
// returning an empty 200 (emptyResponse: `new Response(null)`) before route logic runs.
//
// The guard exists in three variants: async request hook, sync request hook, and
// traced. The plain path (no trace, no request hook) has NO abort guard; this is
// intentional since it is the hot path and the overhead isn't justified.

const preAborted = () => {
	const controller = new AbortController()
	controller.abort()
	return controller
}

// Fire the request with the aborted signal, assert the handler never ran and
// the response is emptyResponse.clone() — a 200 with null body.
const expectShortCircuit = async (
	app: any,
	controller: AbortController,
	handlerCalled: () => boolean
) => {
	const res = await app.handle(
		new Request('http://localhost/', { signal: controller.signal })
	)

	expect(handlerCalled()).toBe(false)
	expect(res.status).toBe(200)
	expect(await res.text()).toBe('')
}

describe('abort short-circuit', () => {
	it('pre-aborted request with async request hook: route handler must not execute', async () => {
		// Async-request-hook variant: the guard is checked immediately after
		// parsing the URL, before the first hook iteration.
		let handlerCalled = false

		const app = new Elysia()
			.request(async () => {
				// async → forces the async-request-hook variant of buildFetchHandler
				await Promise.resolve()
			})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		await expectShortCircuit(app, preAborted(), () => handlerCalled)
	})

	it('abort during async request hook iteration: route handler must not execute', async () => {
		// Mid-loop guard: after each async request hook iteration the handler
		// checks `aborted`. An abort that fires DURING the hook (not before the
		// fetch handler is called) must still short-circuit.
		let handlerCalled = false
		const controller = new AbortController()

		const app = new Elysia()
			.request(async () => {
				// Bun exposes the aborted flag synchronously, so the post-hook read
				// observes this abort directly.
				controller.abort()
				await Promise.resolve()
			})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		await expectShortCircuit(app, controller, () => handlerCalled)
	})

	it('pre-aborted request with .trace(): handler must not execute and trace reports must resolve', async () => {
		// Traced variant: .trace() switches to a different buildFetchHandler branch
		// whose abort guard ALSO resolves the trace reporters (trace[j].r(...))
		// before returning. Without that resolution, any listener awaiting the
		// trace promise would hang indefinitely — this test completing at all
		// (no timeout) pins that.
		let handlerCalled = false

		const app = new Elysia()
			// Minimal noop trace — just needs to exist so hasTrace=true
			.trace(() => {})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		await expectShortCircuit(app, preAborted(), () => handlerCalled)
	})

	it('sync request hook short-circuits on pre-aborted signal', async () => {
		// Sync-request-hook variant: guarded pre-URL and mid-loop, same as the
		// async variant — a pre-aborted signal returns emptyResponse immediately.
		let handlerCalled = false

		const app = new Elysia()
			.request(() => {
				// sync request hook — forces the sync-request-hook variant
			})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		await expectShortCircuit(app, preAborted(), () => handlerCalled)
	})
})
