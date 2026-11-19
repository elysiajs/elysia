import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

// `stop(closeActiveConnections)` always stops the server, the flag only controls
// whether a request already inside a handler is aborted rather than drained.
// Holds a request in the handler until stop() has been called, so the request is
// genuinely in-flight without depending on any timing
const stopWithInflightRequest = async (closeActiveConnections: boolean) => {
	let reachHandler!: () => void
	let releaseHandler!: () => void

	const reachedHandler = new Promise<void>(
		(resolve) => (reachHandler = resolve)
	)
	const handlerReleased = new Promise<void>(
		(resolve) => (releaseHandler = resolve)
	)

	const app = new Elysia()
	app.get('/slow', async () => {
		reachHandler()
		await handlerReleased

		return 'hi'
	})

	const server = app.listen(0)
	const port = app.server!.port

	// Settle the outcome eagerly, an aborted request must not surface as an
	// unhandled rejection while the test is awaiting stop()
	const inflight = fetch(`http://localhost:${port}/slow`).then(
		async (response) => ({
			completed: true,
			status: response.status,
			body: await response.text()
		}),
		() => ({ completed: false, status: 0, body: '' })
	)

	await reachedHandler

	const stopped = server.stop(closeActiveConnections)
	releaseHandler()
	await stopped

	return inflight
}

describe('Stop', () => {
	it('shuts down the server when stop(true) is called', async () => {
		const app = new Elysia()
		app.get('/health', 'hi')

		const server = app.listen(0)
		const port = app.server!.port

		expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200)

		await server.stop(true)

		// Check if the server is still running
		expect(app.server).toBeNull()
		await expect(fetch(`http://localhost:${port}/health`)).rejects.toThrow()
	})

	it('shuts down the server when stop(false) is called', async () => {
		const app = new Elysia()
		app.get('/health', 'hi')

		const server = app.listen(0)
		const port = app.server!.port

		expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200)

		await server.stop(false)

		// Check if the server is still running
		expect(app.server).toBeNull()
		await expect(fetch(`http://localhost:${port}/health`)).rejects.toThrow()
	})

	it('drains in-flight requests when stop(false) is called', async () => {
		expect(await stopWithInflightRequest(false)).toEqual({
			completed: true,
			status: 200,
			body: 'hi'
		})
	})

	it('aborts in-flight requests when stop(true) is called', async () => {
		expect(await stopWithInflightRequest(true)).toEqual({
			completed: false,
			status: 0,
			body: ''
		})
	})
})
