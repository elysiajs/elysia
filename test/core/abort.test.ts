import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

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

	it('lets a traced synchronous pipeline finish when pre-aborted', async () => {
		let handlerCalled = false

		const app = new Elysia()
			.trace(() => {})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		const res = await app.handle(
			new Request('http://localhost/', {
				signal: preAborted().signal
			})
		)

		expect(handlerCalled).toBe(true)
		await expect(res.text()).resolves.toBe('never')
	})

	it('lets a synchronous request hook and route finish when pre-aborted', async () => {
		let handlerCalled = false

		const app = new Elysia()
			.request(() => {})
			.get('/', () => {
				handlerCalled = true

				return 'never'
			})

		const res = await app.handle(
			new Request('http://localhost/', {
				signal: preAborted().signal
			})
		)

		expect(handlerCalled).toBe(true)
		await expect(res.text()).resolves.toBe('never')
	})

	it('keeps pre-abort polling in compat mode', async () => {
		let handlerCalled = false
		const app = new Elysia({
			experimental: { cancellation: 'compat' }
		})
			.request(() => {})
			.get('/', () => {
				handlerCalled = true
				return 'never'
			})

		await expectShortCircuit(app, preAborted(), () => handlerCalled)
	})
})
