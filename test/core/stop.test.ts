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
	// I have nothing but my burger and I want nothing more
	it('releases its beforeExit listener on every listen/stop cycle', async () => {
		const before = process.listeners('beforeExit')
		const unrelated = () => {}
		process.on('beforeExit', unrelated)
		const app = new Elysia().get('/', 'hi')
		try {
			for (let i = 0; i < 12; i++) {
				app.listen(0)
				expect(process.listeners('beforeExit')).toHaveLength(
					before.length + 2
				)
				await app.stop()
				expect(process.listeners('beforeExit')).toEqual([
					...before,
					unrelated
				])
			}
		} finally {
			if (app.server) await app.stop(true)
			for (const listener of process.listeners('beforeExit'))
				if (!before.includes(listener))
					process.removeListener('beforeExit', listener)
		}
	})

	it('keeps another app listener and runs stop hooks during beforeExit', async () => {
		const before = process.listeners('beforeExit')
		let stops = 0
		const first = new Elysia().get('/', 'first').listen(0)
		const second = new Elysia()
			.onStop(() => {
				stops++
			})
			.get('/', 'second')
			.listen(0)
		const listeners = process
			.listeners('beforeExit')
			.filter((listener) => !before.includes(listener))
		try {
			expect(listeners).toHaveLength(2)
			await first.stop()
			expect(process.listeners('beforeExit')).toEqual([
				...before,
				listeners[1]
			])
			await listeners[1](0)
			expect(second.server).toBeNull()
			expect(stops).toBe(1)
			expect(process.listeners('beforeExit')).toEqual(before)
		} finally {
			if (first.server) await first.stop(true)
			if (second.server) await second.stop(true)
			for (const listener of listeners)
				process.removeListener('beforeExit', listener)
		}
	})

	for (const callback of ['start', 'listen'] as const)
		it(`cleans up when the ${callback} callback stops the app`, async () => {
			const before = process.listeners('beforeExit')
			const app = new Elysia().get('/', 'hi')
			let stopped: Promise<unknown> | undefined
			try {
				if (callback === 'start')
					app.onStart(() => {
						stopped = app.stop()
					})
				app.listen(0, () => {
					if (callback === 'listen') stopped = app.stop()
				})
				await stopped
				expect(app.server).toBeNull()
				expect(process.listeners('beforeExit')).toEqual(before)
			} finally {
				if (app.server) await app.stop(true)
				for (const listener of process.listeners('beforeExit'))
					if (!before.includes(listener))
						process.removeListener('beforeExit', listener)
			}
		})

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
