import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { trace } from '../../src/plugin/trace'
import { origin } from '../../src/adapter/origin'

const preAborted = () => {
	const controller = new AbortController()
	controller.abort()
	return controller
}

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
	await expect(res.text()).resolves.toBe('')
}

describe('abort short-circuit', () => {
	it('skips the route for a pre-aborted request with an async request hook', async () => {
		let handlerCalled = false

		const app = new Elysia()
			.request(async () => {
				await Promise.resolve()
			})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		await expectShortCircuit(app, preAborted(), () => handlerCalled)
	})

	it('stops after an async request hook aborts the request', async () => {
		let handlerCalled = false
		const controller = new AbortController()

		const app = new Elysia()
			.request(async () => {
				controller.abort()
				await Promise.resolve()
			})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		await expectShortCircuit(app, controller, () => handlerCalled)
	})

	it('resolves trace reports when a pre-aborted request short-circuits', async () => {
		let handlerCalled = false

		const app = new Elysia()
			.use(trace())
			.trace(() => {})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		await expectShortCircuit(app, preAborted(), () => handlerCalled)
	})

	it('skips the route for a pre-aborted request with a sync request hook', async () => {
		let handlerCalled = false

		const app = new Elysia()
			.request(() => {})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		await expectShortCircuit(app, preAborted(), () => handlerCalled)
	})

	it('stops the next async request hook once an earlier one aborts', async () => {
		// pins the per-iteration check in the async request-hook lane: every
		// awaited hook is a suspension boundary, so the abort must be observed
		// there and not deferred to the route
		const controller = new AbortController()
		let secondHookCalled = false
		let handlerCalled = false

		const app = new Elysia()
			.request(async () => {
				await Promise.resolve()
				controller.abort()
			})
			.request(() => {
				secondHookCalled = true
			})
			.get('/', () => {
				handlerCalled = true
				return 'never'
			})

		await expectShortCircuit(app, controller, () => handlerCalled)
		expect(secondHookCalled).toBe(false)
	})
})

const serve = async (app: any, fn: (port: number) => Promise<void>) => {
	const server = app.listen(0)
	try {
		await new Promise((r) => setTimeout(r, 20))
		await fn((app.server as any).port)
	} finally {
		server.stop(true)
	}
}

describe('abort signal arming', () => {
	it('never materializes request.signal for a fully synchronous route served by Bun', async () => {
		// The saving: a pipeline that cannot suspend cannot observe an abort,
		// so the (lazily materialized) `request.signal` must stay untouched.
		// `'~sig'` is the internal arming slot — undefined means unarmed.
		let armedInHook: unknown = 'unset'
		let armedInHandler: unknown = 'unset'

		const app = new Elysia()
			.beforeHandle((context: any) => {
				armedInHook = context['~sig']
			})
			.get('/', (context: any) => {
				armedInHandler = context['~sig']
				return 'ok'
			})

		await serve(app, async (port) => {
			const res = await fetch(`http://localhost:${port}/`)
			await expect(res.text()).resolves.toBe('ok')
		})

		expect(armedInHook).toBeUndefined()
		expect(armedInHandler).toBeUndefined()
	})

	it('reads the request.signal getter zero times on the deferred path', async () => {
		// `Request.prototype.signal` is an unconfigurable native getter on Bun,
		// so the only way to count reads is a subclass. Publishing it through
		// the provenance channel is exactly what the Bun adapter does around
		// its `app.fetch` call.
		let reads = 0

		class SpyRequest extends Request {
			get signal() {
				reads++
				return super.signal
			}
		}

		const app = new Elysia().beforeHandle(() => {}).get('/', () => 'ok')

		void app.fetch

		const deferred = new SpyRequest('http://localhost/')
		origin.request = deferred
		try {
			await expect((await app.fetch(deferred)).text()).resolves.toBe('ok')
		} finally {
			origin.request = undefined
		}

		expect(reads).toBe(0)

		// same request, no provenance → eager arming → exactly one read
		const eager = new SpyRequest('http://localhost/')
		await expect((await app.fetch(eager)).text()).resolves.toBe('ok')
		expect(reads).toBe(1)
	})

	it('arms after a suspension so post-await checks keep working', async () => {
		let armedAfterAwait: unknown = 'unset'

		const app = new Elysia()
			.transform(async () => {
				await Promise.resolve()
			})
			.beforeHandle((context: any) => {
				armedAfterAwait = context['~sig']
			})
			.get('/', () => 'ok')

		await serve(app, async (port) => {
			const res = await fetch(`http://localhost:${port}/`)
			await expect(res.text()).resolves.toBe('ok')
		})

		expect(armedAfterAwait).toBeInstanceOf(AbortSignal)
	})

	it('arms eagerly for in-process dispatch, preserving sync self-abort', async () => {
		const controller = new AbortController()
		let secondHookCalled = false

		const app = new Elysia()
			.beforeHandle(() => {
				controller.abort()
			})
			.beforeHandle(() => {
				secondHookCalled = true
			})
			.get('/', () => 'ok')

		const res = await app.handle(
			new Request('http://localhost/', { signal: controller.signal })
		)

		expect(secondHookCalled).toBe(false)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('')
	})

	it('falls back to eager arming when a wrap HOC substitutes the request', async () => {
		// The HOC hands the pipeline a Request the Bun adapter never saw, so
		// its signal may already be aborted (or be aborted synchronously by a
		// hook) with no suspension in between. Provenance must miss here, or
		// the second beforeHandle would run after the abort.
		const controller = new AbortController()
		let secondHookCalled = false

		const app = new Elysia()
			.wrap(
				(next: any) => (request: Request, server: unknown) =>
					next(
						new Request(request, { signal: controller.signal }),
						server
					)
			)
			.beforeHandle(() => {
				controller.abort()
			})
			.beforeHandle(() => {
				secondHookCalled = true
			})
			.get('/', () => 'ok')

		await serve(app, async (port) => {
			const res = await fetch(`http://localhost:${port}/`)
			expect(res.status).toBe(200)
			await expect(res.text()).resolves.toBe('')
		})

		expect(secondHookCalled).toBe(false)
	})
})

describe('hook-less routes never observe abort', () => {
	// `abortOn` is `hasLifecycleHook`: a route with no lifecycle hook has no
	// stage at which an abort could be observed (`types.ts`), so arming its
	// slot buys nothing and costs a `request.signal` materialization on every
	// request. These pin that the cost is gone AND that removing it did not
	// quietly change what such a route does with an aborted signal.

	class SpyRequest extends Request {
		// `Request.prototype.signal` is an unconfigurable native getter on Bun,
		// so a subclass is the only way to count reads
		static reads = 0

		get signal() {
			SpyRequest.reads++

			return super.signal
		}
	}

	it('reads request.signal zero times for a hook-less, schema-only route', async () => {
		SpyRequest.reads = 0

		const app = new Elysia().get(
			'/',
			{ query: t.Object({ name: t.String() }) },
			({ query }) => query.name
		)

		// no provenance: `app.handle` is exactly the lane that used to arm
		// eagerly for every request, hook or not
		const res = await app.handle(new SpyRequest('http://localhost/?name=a'))

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('a')
		expect(SpyRequest.reads).toBe(0)
	})

	it('runs a hook-less route to completion for a pre-aborted request', async () => {
		let handlerCalled = false

		const app = new Elysia().get('/', () => {
			handlerCalled = true

			return 'ran'
		})

		const res = await app.handle(
			new Request('http://localhost/', { signal: preAborted().signal })
		)

		// the contract, unchanged by the arming move: abort is only ever
		// observed at a lifecycle stage, and this route has none
		expect(handlerCalled).toBe(true)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ran')
	})

	it('still short-circuits the same route once it has a beforeHandle', async () => {
		// the contrast that makes the test above a decision and not an
		// accident: adding one hook restores eager arming at route entry, on
		// the same in-process lane, with no `.request()` hook to arm ahead of it
		let handlerCalled = false

		const app = new Elysia()
			.beforeHandle(() => {})
			.get('/', () => {
				handlerCalled = true

				return 'ran'
			})

		const res = await app.handle(
			new Request('http://localhost/', { signal: preAborted().signal })
		)

		expect(handlerCalled).toBe(false)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('')
	})
})

describe('abortSignal: false', () => {
	it('runs the whole pipeline for an already-aborted request', async () => {
		let handlerCalled = false

		const app = new Elysia({ abortSignal: false })
			.request(() => {})
			.beforeHandle(() => {})
			.get('/', () => {
				handlerCalled = true
				return 'ran'
			})

		const res = await app.handle(
			new Request('http://localhost/', {
				signal: preAborted().signal
			})
		)

		expect(handlerCalled).toBe(true)
		await expect(res.text()).resolves.toBe('ran')
	})
})
