import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'

describe('Bun adapter — async module reload', () => {
	it('queues requests until async modules resolve', async () => {
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

		let settled = false
		const sync = fetch(`${baseUrl}/sync`).then((r) => r.text())
		const async = fetch(`${baseUrl}/async`).then((r) => r.text())
		async.finally(() => (settled = true))

		await Bun.sleep(10)
		expect(settled).toBe(false)

		resolveLater(new Elysia().get('/async', () => 'async'))
		await app.modules

		await expect(async).resolves.toBe('async')
		await expect(sync).resolves.toBe('sync')

		await app.server!.stop(true)
	})

	it('rolls back when one async plugin fails', async () => {
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

			await expect(app.modules).rejects.toThrow('plugin-fail')
			await Bun.sleep(10)

			expect(errors.length).toBeGreaterThan(0)
			expect(app.server).toBeUndefined()
			await expect(
				fetch(`http://localhost:${port}/sync`, {
					signal: AbortSignal.timeout(100)
				})
			).rejects.toThrow()
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
