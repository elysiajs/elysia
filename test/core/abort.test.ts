import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'

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
	expect(await res.text()).toBe('')
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
			.use(trace()).trace(() => {})
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
})
