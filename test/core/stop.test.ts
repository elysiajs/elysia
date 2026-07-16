import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('Stop', () => {
	const withServeCount = async (run: () => void | Promise<void>) => {
		const realServe = Bun.serve.bind(Bun)
		let calls = 0
		const created: any[] = []
		;(Bun as any).serve = (opts: any) => {
			calls++
			const s = realServe(opts)
			created.push(s)
			return s
		}

		try {
			await run()
			await new Promise((r) => setTimeout(r, 50))

			let liveOrphans = 0
			for (const s of created) {
				try {
					const res = await fetch(
						'http://localhost:' + s.port + '/',
						{ signal: AbortSignal.timeout(150) }
					)
					await res.text().catch(() => {})
					liveOrphans++
				} catch {}
			}

			return { calls, liveOrphans, created }
		} finally {
			for (const s of created) {
				try {
					s.stop?.(true)
				} catch {}
			}
			;(Bun as any).serve = realServe
		}
	}

	it('stops immediately after listen without creating an orphan server', async () => {
		const result = await withServeCount(() => {
			const app = new Elysia().get('/', () => 'hi')
			app.listen(0)
			app.stop()
			expect(app.server).toBeUndefined()
		})

		expect(result!.calls).toBe(1)
		expect(result!.liveOrphans).toBe(0)
	})

	it('stops an async-plugin app immediately without creating an orphan server', async () => {
		const result = await withServeCount(() => {
			const app = new Elysia()
				.use(Promise.resolve(new Elysia().get('/p', () => 'p')))
				.get('/', () => 'hi')
			app.listen(0)
			app.stop()
			expect(app.server).toBeUndefined()
		})

		expect(result!.calls).toBe(1)
		expect(result!.liveOrphans).toBe(0)
	})

	it('stops while async modules resolve without throwing or leaving a server', async () => {
		let threw: unknown
		const result = await withServeCount(async () => {
			const slow = new Promise<any>((resolve) =>
				setTimeout(() => resolve(new Elysia().get('/p', () => 'p')), 40)
			)
			const app = new Elysia().use(slow as any).get('/', () => 'hi')
			app.listen(0)

			try {
				await new Promise((r) => setTimeout(r, 15))
				app.stop()
				await new Promise((r) => setTimeout(r, 120))
			} catch (e) {
				threw = e
			}

			expect(app.server).toBeUndefined()
		})

		expect(threw).toBeUndefined()
		expect(result!.calls).toBe(1)
		expect(result!.liveOrphans).toBe(0)
	})

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
			await expect(response.text()).resolves.toBe('hi')
		} catch (error) {
			throw new Error('Server unexpectedly shut down')
		}
	})
})
