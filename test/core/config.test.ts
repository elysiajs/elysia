import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'

describe('config', () => {
	it('preserves standard and short-host path scan offsets', async () => {
		for (const [standardHostname, url, pathStart] of [
			[undefined, 'http://localhost/a', 11],
			[false, 'http://a/a', 7]
		] as const) {
			const app = new Elysia({
				handler:
					standardHostname === undefined
						? undefined
						: { standardHostname }
			}).get('/a', 'a')

			await expect((await app.handle(new Request(url))).text()).resolves.toBe('a')
			expect(app['~generation']!.plan.application.fetch.pathStart).toBe(
				pathStart
			)
		}
	})

	it('append prefix / if not provided', () => {
		const plugin = new Elysia({ prefix: 'v1' }).get('thing', 'thing')

		const app = new Elysia({ prefix: 'api' }).use(plugin)

		expect(app.routes[0].path).toBe('/api/v1/thing')

		// This should not error
		app['~Routes']?.api.v1.thing
	})
})
