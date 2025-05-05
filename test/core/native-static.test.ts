import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'

describe('Native Static Response', () => {
	it('work', async () => {
		const app = new Elysia().get('/', 'Static Content')

		expect(app.router.response['/']).toBeInstanceOf(Response)
		expect(await app.router.response['/'].text()).toEqual('Static Content')
	})

	it('handle plugin', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = new Elysia().use(plugin).get('/', 'Static Content')

		expect(app.router.response['/']).toBeInstanceOf(Response)
		expect(await app.router.response['/'].text()).toEqual('Static Content')

		expect(app.router.response['/plugin']).toBeInstanceOf(Response)
		expect(await app.router.response['/plugin'].text()).toEqual('Plugin')
	})

	it('handle default header', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = new Elysia()
			.headers({ server: 'Elysia' })
			.use(plugin)
			.get('/', 'Static Content')

		expect(app.router.response['/']).toBeInstanceOf(Response)
		expect(app.router.response['/'].headers.toJSON()).toEqual({
			'content-type': 'text/plain',
			server: 'Elysia'
		})
		expect(await app.router.response['/'].text()).toEqual('Static Content')

		expect(app.router.response['/plugin']).toBeInstanceOf(Response)
		expect(app.router.response['/plugin'].headers.toJSON()).toEqual({
			'content-type': 'text/plain',
			server: 'Elysia'
		})
		expect(await app.router.response['/plugin'].text()).toEqual('Plugin')
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

		expect(app.router.response['/']).toBeInstanceOf(Response)
		expect(await app.router.response['/'].text()).toEqual('Static Content')

		expect(app.router.response['']).toBeInstanceOf(Response)
		expect(await app.router.response[''].text()).toEqual('Static Content')

		expect(app.router.response['/plugin']).toBeInstanceOf(Response)
		expect(await app.router.response['/plugin'].text()).toEqual('Plugin')

		expect(app.router.response['/plugin/']).toBeInstanceOf(Response)
		expect(await app.router.response['/plugin/'].text()).toEqual('Plugin')

		const loose = new Elysia({ strictPath: true })
			.use(plugin)
			.get('/', 'Static Content')

		expect(loose.router.response['/']).toBeInstanceOf(Response)
		expect(await loose.router.response['/'].text()).toEqual(
			'Static Content'
		)
		expect(loose.router.response).not.toHaveProperty('')

		expect(loose.router.response['/plugin']).toBeInstanceOf(Response)
		expect(await loose.router.response['/plugin'].text()).toEqual('Plugin')
		expect(loose.router.response).not.toHaveProperty('/plugin/')
	})
})
