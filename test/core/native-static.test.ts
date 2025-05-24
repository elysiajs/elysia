import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'

describe('Native Static Response', () => {
	it('work', async () => {
		const app = new Elysia().get('/', 'Static Content')

		expect(app.router.response['/'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/'].GET.text()).toEqual('Static Content')
	})

	it('handle plugin', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = new Elysia().use(plugin).get('/', 'Static Content')

		expect(app.router.response['/'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/'].GET.text()).toEqual('Static Content')

		expect(app.router.response['/plugin'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/plugin'].GET.text()).toEqual('Plugin')
	})

	it('handle default header', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = new Elysia()
			.headers({ server: 'Elysia' })
			.use(plugin)
			.get('/', 'Static Content')

		expect(app.router.response['/'].GET).toBeInstanceOf(Response)
		expect(app.router.response['/'].GET.headers.toJSON()).toEqual({
			'content-type': 'text/plain',
			server: 'Elysia'
		})
		expect(await app.router.response['/'].GET.text()).toEqual('Static Content')

		expect(app.router.response['/plugin'].GET).toBeInstanceOf(Response)
		expect(app.router.response['/plugin'].GET.headers.toJSON()).toEqual({
			'content-type': 'text/plain',
			server: 'Elysia'
		})
		expect(await app.router.response['/plugin'].GET.text()).toEqual('Plugin')
	})

	it('turn off by config', async () => {
		const app = new Elysia({ nativeStaticResponse: false }).get(
			'/',
			'Static Content'
		)

		expect(app.router.response).not.toHaveProperty('/')
	})

	it('handle loose path', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = new Elysia().use(plugin).get('/', 'Static Content')

		expect(app.router.response['/'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/'].GET.text()).toEqual('Static Content')

		expect(app.router.response[''].GET).toBeInstanceOf(Response)
		expect(await app.router.response[''].GET.text()).toEqual('Static Content')

		expect(app.router.response['/plugin'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/plugin'].GET.text()).toEqual('Plugin')

		expect(app.router.response['/plugin/'].GET).toBeInstanceOf(Response)
		expect(await app.router.response['/plugin/'].GET.text()).toEqual('Plugin')

		const strict = new Elysia({ strictPath: true })
			.use(plugin)
			.get('/', 'Static Content')

		expect(strict.router.response['/'].GET).toBeInstanceOf(Response)
		expect(await strict.router.response['/'].GET.text()).toEqual(
			'Static Content'
		)
		expect(strict.router.response).not.toHaveProperty('')

		expect(strict.router.response['/plugin'].GET).toBeInstanceOf(Response)
		expect(await strict.router.response['/plugin'].GET.text()).toEqual('Plugin')
		expect(strict.router.response).not.toHaveProperty('/plugin/')
	})
})
