import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'

describe('config', () => {
	it('standard hostname', async () => {
		const app = new Elysia({ handler: { standardHostname: false } }).get(
			'/a',
			'a'
		)

		const response = await app
			.handle(new Request('http://a/a'))
			.then((x) => x.text())

		expect(response).toBe('a')
	})

	it('append prefix / if not provided', () => {
		const plugin = new Elysia({ prefix: 'v1' }).get('thing', 'thing')

		const app = new Elysia({ prefix: 'api' }).use(plugin)

		expect(app.routes[0].path).toBe('/api/v1/thing')

		// This should not error
		app['~Routes']?.api.v1.thing
	})
})
