import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'

describe('Bun adapter — async module reload', () => {
	it('reloads the running server after async modules resolve', async () => {
		let resolveLater!: (v: any) => void
		const pending = new Promise((res) => {
			resolveLater = res
		})

		const app = new Elysia()
			.get('/sync', () => 'sync')
			.use(pending as Promise<any>)

		app.listen(0)

		const port = app.server!.port
		const baseUrl = `http://localhost:${port}`

		// Sync route is reachable immediately.
		const syncBefore = await fetch(`${baseUrl}/sync`).then((r) => r.text())
		expect(syncBefore).toBe('sync')

		// Async route is NOT reachable yet — server.reload hasn't fired.
		const asyncBefore = await fetch(`${baseUrl}/async`).then(
			(r) => r.status
		)
		expect(asyncBefore).toBe(404)

		// Resolve the async plugin and wait for the chain to settle (which
		// triggers the adapter's .then → server.reload).
		resolveLater(new Elysia().get('/async', () => 'async'))
		await app.modules

		// Async route is now reachable through the same port.
		const asyncAfter = await fetch(`${baseUrl}/async`).then((r) => r.text())
		expect(asyncAfter).toBe('async')

		// Sync route still works after reload.
		const syncAfter = await fetch(`${baseUrl}/sync`).then((r) => r.text())
		expect(syncAfter).toBe('sync')

		await app.server!.stop(true)
	})

	it('still reloads when one async plugin fails (partial success)', async () => {
		const errors: unknown[] = []
		const orig = console.error
		console.error = (...a: unknown[]) => {
			errors.push(a[0])
		}

		try {
			const app = new Elysia()
				.get('/sync', () => 'sync')
				// Failing plugin: should not block the other from registering.
				.use(Promise.reject(new Error('plugin-fail')))
				// Successful plugin: its routes must reach the served port.
				.use(Promise.resolve(new Elysia().get('/ok', () => 'ok')))

			app.listen(0)
			const port = app.server!.port

			// Drain (and swallow the modules rejection — adapter's catch
			// arm fires too, then reload runs anyway).
			try {
				await app.modules
			} catch {}

			// Give the adapter's `.then(reload)` microtask a tick to land.
			await new Promise((r) => setTimeout(r, 10))

			const ok = await fetch(`http://localhost:${port}/ok`).then((r) =>
				r.text()
			)
			expect(ok).toBe('ok')

			const sync = await fetch(`http://localhost:${port}/sync`).then(
				(r) => r.text()
			)
			expect(sync).toBe('sync')

			expect(errors.length).toBeGreaterThan(0)

			await app.server!.stop(true)
		} finally {
			console.error = orig
		}
	})

	it('does not reload when no async plugin is pending', async () => {
		const app = new Elysia().get('/', () => 'ok')

		app.listen(0)
		const port = app.server!.port

		const res = await fetch(`http://localhost:${port}/`).then((r) =>
			r.text()
		)
		expect(res).toBe('ok')

		// Modules getter returns a settled promise immediately.
		await expect(app.modules).resolves.toBeUndefined()

		await app.server!.stop(true)
	})
})
