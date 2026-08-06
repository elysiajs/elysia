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
			let resolveSlow!: (plugin: any) => void
			const slow = new Promise<any>((resolve) => {
				resolveSlow = resolve
			})
			const app = new Elysia().use(slow as any).get('/', () => 'hi')
			app.listen(0)

			try {
				// stop while the async module is still unresolved
				app.stop()
				resolveSlow(new Elysia().get('/p', () => 'p'))
				await app.modules
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

		const server = app.listen(0)
		const port = server.server!.port

		await fetch(`http://localhost:${port}/health`)

		await server.stop(true)

		// The server must no longer accept connections
		await expect(fetch(`http://localhost:${port}/health`)).rejects.toThrow()
	})

	it('does not shut down the server when stop(false) is called', async () => {
		const app = new Elysia()
		app.get('/health', 'hi')

		const server = app.listen(0)
		// stop(false) clears `app.server`, so keep a handle for teardown
		const bunServer = server.server!
		const port = bunServer.port

		try {
			await fetch(`http://localhost:${port}/health`)

			await server.stop(false)

			// Check if the server is still running
			const response = await fetch(`http://localhost:${port}/health`)
			expect(response.status).toBe(200)
			await expect(response.text()).resolves.toBe('hi')
		} finally {
			await bunServer.stop(true)
		}
	})
})
