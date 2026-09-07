import { afterEach, describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

describe('Bun async modules', () => {
	// Failed startup sets exitCode; reset it between tests.
	afterEach(() => {
		process.exitCode = 0
	})

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
				.use(Promise.reject(new Error('plugin-fail')))
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

		await expect(app.modules).resolves.toBeUndefined()

		await app.server!.stop(true)
	})

	it('does not build the router before pending plugins resolve', async () => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const plugin = gate.then(() => new Elysia().get('/late', 'late'))
		const app = new Elysia().use(plugin).get('/', 'Static').listen(0)

		await Bun.sleep(20)
		expect(app.pending).toBe(true)
		expect(app['~staticResponse' as keyof typeof app]).toBeUndefined()

		const base = `http://localhost:${app.server!.port}`
		const pendingResponse = fetch(`${base}/`)

		await Bun.sleep(20)
		release()

		const response = await pendingResponse
		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('Static')

		await app.modules
		await Bun.sleep(20)

		const late = await fetch(`${base}/late`)
		expect(late.status).toBe(200)
		await expect(late.text()).resolves.toBe('late')
		await expect(fetch(`${base}/`).then((x) => x.text())).resolves.toBe(
			'Static'
		)

		app.stop()
	})

	it('does not wait on a never-settling module when forced to stop', async () => {
		const app = new Elysia()
			.get('/', 'ok')
			.use(new Promise<never>(() => {}) as Promise<any>)

		app.listen(0)
		const port = app.server!.port

		await Bun.sleep(10)
		expect(app.pending).toBe(true)

		// Forced shutdown must not wait for plugin setup.
		const started = Bun.nanoseconds()
		await app.stop(true)
		expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(200)

		const rebound = Bun.serve({ port, fetch: () => new Response('free') })
		expect(rebound.port).toBe(port)
		await rebound.stop(true)
	})

	it('abandons a never-settling module when a later stop forces', async () => {
		const app = new Elysia()
			.get('/', 'ok')
			.use(new Promise<never>(() => {}) as Promise<any>)

		app.listen(0)
		await Bun.sleep(10)

		const stopping = app.stop()!
		await Bun.sleep(10)

		// A later forced stop must unblock the existing shutdown.
		expect(app.stop(true)).toBe(stopping)

		const started = Bun.nanoseconds()
		await stopping
		expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(200)
	})

	it('keeps waiting on a pending module when stopped without force', async () => {
		let release!: (plugin: Elysia) => void
		const plugin = new Promise<Elysia>((resolve) => (release = resolve))
		const app = new Elysia().get('/', 'ok').use(plugin)

		app.listen(0)
		await Bun.sleep(10)

		// Graceful shutdown waits for plugin cleanup.
		let settled = false
		const stopping = app.stop()!
		stopping.then(() => (settled = true))

		await Bun.sleep(100)
		expect(settled).toBe(false)

		let cleaned = 0
		release(new Elysia().cleanup(() => cleaned++))
		await stopping

		expect(settled).toBe(true)
		expect(cleaned).toBe(1)
	})

	it('serves WebSocket routes from a pending plugin', async () => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const plugin = gate.then(() =>
			new Elysia().use(websocket()).ws('/ws', {
				message(ws, message) {
					ws.send(`echo:${message}`)
				}
			})
		)
		const app = new Elysia().use(plugin).get('/', 'ok').listen(0)

		await Bun.sleep(20)
		release()
		await app.modules
		await Bun.sleep(20)

		const ws = new WebSocket(`ws://localhost:${app.server!.port}/ws`)
		const result = await new Promise<string>((resolve) => {
			const timer = setTimeout(() => resolve('TIMEOUT'), 2000)

			ws.onopen = () => ws.send('hi')
			ws.onmessage = (event) => {
				clearTimeout(timer)
				resolve(event.data as string)
			}
			ws.onerror = () => {
				clearTimeout(timer)
				resolve('ERROR')
			}
		})

		expect(result).toBe('echo:hi')

		ws.close()
		app.stop()
	})
})
