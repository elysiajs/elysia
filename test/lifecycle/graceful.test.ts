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
})
