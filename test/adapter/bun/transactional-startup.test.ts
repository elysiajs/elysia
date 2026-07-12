import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../../src'

describe('Bun transactional startup', () => {
	const withServer = async (
		run: (
			getOptions: () => any,
			server: {
				stopped: boolean
				reloads: number
				reloadError?: Error
			}
		) => unknown
	) => {
		const serve = Bun.serve
		let options: any
		const server = {
			port: 3000,
			stopped: false,
			reloads: 0,
			reloadError: undefined as Error | undefined,
			reload(next: any) {
				options = next
				this.reloads++
				if (this.reloadError) throw this.reloadError
			},
			stop() {
				this.stopped = true
			}
		}

		;(Bun as any).serve = (next: any) => {
			options = next
			return server
		}

		try {
			return await run(() => options, server)
		} finally {
			;(Bun as any).serve = serve
		}
	}

	it('builds before opening a server', async () => {
		let calls = 0
		const serve = Bun.serve
		;(Bun as any).serve = () => {
			calls++
		}

		try {
			// build-time failure injector: an unknown named model reference
			// throws inside #buildRouterUnsafe, before Bun.serve is reached
			const app = new Elysia().get(
				'/x',
				{ body: 'DoesNotExist' },
				() => 'first'
			)

			expect(() => app.listen(0)).toThrow('Unknown model reference')
			expect(calls).toBe(0)
			expect(app.server).toBeUndefined()
		} finally {
			;(Bun as any).serve = serve
		}
	})

	it('rolls back a synchronous setup failure in LIFO order', () =>
		withServer((_getOptions, server) => {
			const order: string[] = []
			let callbackCalled = false
			const app = new Elysia()
				.cleanup(() => order.push('first'))
				.cleanup(() => order.push('second'))
				.setup(() => {
					order.push('setup')
					throw new Error('setup failed')
				})
				.get('/', 'ok')

			expect(() => app.listen(0, () => (callbackCalled = true))).toThrow(
				'setup failed'
			)
			expect(server.stopped).toBe(true)
			expect(app.server).toBeUndefined()
			expect(callbackCalled).toBe(false)
			expect(order).toEqual(['setup', 'second', 'first'])
		}))

	it('queues requests until async plugins are fully built', () =>
		withServer(async (getOptions, server) => {
			let resolve!: (plugin: Elysia) => void
			const plugin = new Promise<Elysia>((done) => (resolve = done))
			let callbackServer: unknown
			const app = new Elysia().use(plugin).listen(0, (value) => {
				callbackServer = value
			})

			const response = getOptions().fetch(
				new Request('http://localhost/plugin'),
				server
			)
			resolve(new Elysia().get('/plugin', 'ready'))

			await expect(
				response.then((x: Response) => x.text())
			).resolves.toBe('ready')
			expect(callbackServer).toBe(server)
			expect(app.server).toBe(server as any)
			expect(server.stopped).toBe(false)
		}))

	it('queues requests until async setup completes', () =>
		withServer(async (getOptions, server) => {
			let finish!: () => void
			const setup = new Promise<void>((resolve) => (finish = resolve))
			const app = new Elysia()
				.setup(() => setup)
				.get('/', 'ready')
				.listen(0)

			let settled = false
			const response = getOptions()
				.fetch(new Request('http://localhost/'), server)
				.then((value: Response) => {
					settled = true
					return value.text()
				})

			await Bun.sleep(0)
			expect(settled).toBe(false)

			finish()
			await expect(response).resolves.toBe('ready')
			expect(app.server).toBe(server as any)
		}))

	it('rolls back when promotion cannot reload or fall back', () =>
		withServer((_getOptions, server) => {
			server.reloadError = new Error('reload failed')
			const app = new Elysia().get('/', 'static')

			expect(() => app.listen(0)).toThrow('reload failed')
			expect(server.reloads).toBe(2)
			expect(server.stopped).toBe(true)
			expect(app.server).toBeUndefined()
		}))

	it('stops the server when an async build fails', () =>
		withServer(async (getOptions, server) => {
			let resolve!: (plugin: Elysia) => void
			const plugin = new Promise<Elysia>((done) => (resolve = done))
			const app = new Elysia()
				.get('/x', () => 'first')
				.use(plugin)
				.listen(0)

			const response = getOptions().fetch(
				new Request('http://localhost/x'),
				server
			)
			// the late plugin injects an unknown model reference → the drain
			// build throws, and the async failure must stop the server
			resolve(
				new Elysia().get('/y', { body: 'DoesNotExist' }, () => 'second')
			)

			await expect(response).rejects.toThrow('Unknown model reference')
			expect(server.stopped).toBe(true)
			expect(app.server).toBeUndefined()
		}))

	it('keeps successful synchronous listen behavior', () =>
		withServer((_getOptions, server) => {
			let callbackServer: unknown
			const app = new Elysia().get('/', 'ok').listen(0, (value) => {
				callbackServer = value
			})

			expect(app.server).toBe(server as any)
			expect(callbackServer).toBe(server)
			expect(server.stopped).toBe(false)
		}))
})
