import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('Stop', () => {
	it('shuts down the server when stop(true) is called', async () => {
		const app = new Elysia()
		app.get('/health', 'hi')

		const port = 8080
		const server = app.listen(port)

		await fetch(`http://localhost:${port}/health`)

		await server.stop(true)

		// Check if the server is still running
		try {
			await fetch(`http://localhost:${port}/health`)
			throw new Error('Server is still running after teardown')
		} catch (error) {
			expect((error as Error).message).toContain('Unable to connect')
		}
	})

	it('does not shut down the server when stop(false) is called', async () => {
		const app = new Elysia()
		app.get('/health', 'hi')

		const port = 8081
		const server = app.listen(port)

		await fetch(`http://localhost:${port}/health`)

		await server.stop(false)

		// Check if the server is still running
		try {
			const response = await fetch(`http://localhost:${port}/health`)
			expect(response.status).toBe(200)
			expect(await response.text()).toBe('hi')
		} catch (error) {
			throw new Error('Server unexpectedly shut down')
		}
	})
})
