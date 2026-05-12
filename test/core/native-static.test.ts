// @ts-nocheck
import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'

// Touch `app.fetch` to trigger `#buildRouter()` so the
// `~staticResponse` map is populated. The fetch handler is memoized,
// so this is effectively free for subsequent calls.
const build = (app: any) => {
	void app.fetch
	return app
}

describe('Native Static Response', () => {
	it('work', async () => {
		const app = build(new Elysia().get('/', 'Static Content'))

		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)
	})

	it('handle plugin', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = build(
			new Elysia().use(plugin).get('/', 'Static Content')
		)

		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)

		expect(app['~staticResponse']['/plugin'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/plugin'].GET.text()).toEqual(
			'Plugin'
		)
	})

	it('handle default header', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = build(
			new Elysia()
				.headers({ server: 'Elysia' })
				.use(plugin)
				.get('/', 'Static Content')
		)

		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(app['~staticResponse']['/'].GET.headers.get('server')).toBe(
			'Elysia'
		)
		expect(await app['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)

		expect(app['~staticResponse']['/plugin'].GET).toBeInstanceOf(Response)
		expect(
			app['~staticResponse']['/plugin'].GET.headers.get('server')
		).toBe('Elysia')
		expect(await app['~staticResponse']['/plugin'].GET.text()).toEqual(
			'Plugin'
		)
	})

	it('turn off by config', async () => {
		const app = build(
			new Elysia({ nativeStaticResponse: false }).get(
				'/',
				'Static Content'
			)
		)

		// `~staticResponse` is undefined when the feature is disabled — no
		// entries get populated. `?? {}` so the assertion targets a
		// non-undefined value either way.
		expect(app['~staticResponse'] ?? {}).not.toHaveProperty('/')
	})

	it('handle loose path', async () => {
		const plugin = new Elysia().get('/plugin', 'Plugin')

		const app = build(
			new Elysia().use(plugin).get('/', 'Static Content')
		)

		expect(app['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)

		expect(app['~staticResponse'][''].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse'][''].GET.text()).toEqual(
			'Static Content'
		)

		expect(app['~staticResponse']['/plugin'].GET).toBeInstanceOf(Response)
		expect(await app['~staticResponse']['/plugin'].GET.text()).toEqual(
			'Plugin'
		)

		expect(app['~staticResponse']['/plugin/'].GET).toBeInstanceOf(
			Response
		)
		expect(await app['~staticResponse']['/plugin/'].GET.text()).toEqual(
			'Plugin'
		)

		const strict = build(
			new Elysia({ strictPath: true })
				.use(plugin)
				.get('/', 'Static Content')
		)

		expect(strict['~staticResponse']['/'].GET).toBeInstanceOf(Response)
		expect(await strict['~staticResponse']['/'].GET.text()).toEqual(
			'Static Content'
		)
		expect(strict['~staticResponse']).not.toHaveProperty('')

		expect(strict['~staticResponse']['/plugin'].GET).toBeInstanceOf(
			Response
		)
		expect(await strict['~staticResponse']['/plugin'].GET.text()).toEqual(
			'Plugin'
		)
		expect(strict['~staticResponse']).not.toHaveProperty('/plugin/')
	})
})
