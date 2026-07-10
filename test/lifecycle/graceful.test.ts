import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

// `setup` fires after the server is ready; `cleanup` fires when the server is
// stopped. Both are app-global and must survive `.use()` so a plugin can
// register cleanup that the root app still runs.
describe('setup / cleanup life cycle', () => {
	it('fires setup on listen and cleanup on stop()', async () => {
		const order: string[] = []

		const app = new Elysia()
			.setup(() => order.push('setup'))
			.cleanup(() => order.push('cleanup'))
			.get('/', 'hi')
			.listen(0)

		expect(order).toEqual(['setup'])

		await app.stop()

		expect(order).toEqual(['setup', 'cleanup'])
	})

	it('runs handlers registered on a used plugin', async () => {
		const order: string[] = []

		const plugin = new Elysia({ name: 'graceful-plugin' })
			.setup(() => order.push('plugin-setup'))
			.cleanup(() => order.push('plugin-cleanup'))

		const app = new Elysia()
			.use(plugin)
			.setup(() => order.push('app-setup'))
			.listen(0)

		expect(order).toEqual(['plugin-setup', 'app-setup'])

		await app.stop()

		expect(order).toEqual(['plugin-setup', 'app-setup', 'plugin-cleanup'])
	})

	it('accepts an array of handlers', async () => {
		const order: string[] = []

		const app = new Elysia()
			.setup([() => order.push('a'), () => order.push('b')])
			.listen(0)

		expect(order).toEqual(['a', 'b'])

		await app.stop()
	})

	it('stop(boolean) still shuts down the server', async () => {
		const app = new Elysia().get('/health', 'hi').listen(0)
		const port = app.server!.port

		await fetch(`http://localhost:${port}/health`)

		await app.stop(true)

		expect(app.server).toBeUndefined()
	})

	// H05(b): an async setup task must complete BEFORE the user's listen
	// callback fires — the callback is the readiness signal, and traffic /
	// resource use may follow it.
	it('does not fire the listen callback until async setup settles', async () => {
		const order: string[] = []

		const app = new Elysia()
			.setup(async () => {
				await new Promise((r) => setTimeout(r, 25))
				order.push('setup-done')
			})
			.get('/', 'hi')

		await new Promise<void>((resolve) => {
			app.listen(0, () => {
				order.push('listen-callback')
				resolve()
			})
		})

		// setup finished before the callback observed readiness
		expect(order).toEqual(['setup-done', 'listen-callback'])

		await app.stop()
	})

	// H05(a): `await app.stop()` must not resolve while an async cleanup task
	// is still running, and cleanups run sequentially in registration order.
	it('awaits async cleanup handlers sequentially before stop() resolves', async () => {
		const order: string[] = []

		const app = new Elysia()
			.cleanup(async () => {
				await new Promise((r) => setTimeout(r, 25))
				order.push('first')
			})
			.cleanup(async () => {
				await new Promise((r) => setTimeout(r, 1))
				order.push('second')
			})
			.get('/', 'hi')
			.listen(0)

		await app.stop()

		expect(order).toEqual(['first', 'second'])
	})
})
