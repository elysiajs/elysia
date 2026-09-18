import { describe, expect, it } from 'bun:test'

import { compileCookieConfig } from '../../src/cookie/config'
import { buildCookieJar } from '../../src/cookie/utils'

describe('cookie defaults', () => {
	it('isolates mutable defaults between request jars', () => {
		const shared = new Date('2030-01-01T00:00:00.000Z')
		const config = compileCookieConfig(undefined, { expires: shared })

		const first = buildCookieJar(
			{ headers: {}, cookie: {} },
			{ session: 'a' },
			config
		) as any
		first.session.expires.setUTCFullYear(1999)

		const second = buildCookieJar(
			{ headers: {}, cookie: {} },
			{ session: 'b' },
			config
		) as any

		expect(second.session.expires.getUTCFullYear()).toBe(2030)
		expect(config.defaults.expires!.getUTCFullYear()).toBe(2030)
		expect(shared.getUTCFullYear()).toBe(2030)
	})

	it('merges app and route attributes with route values taking precedence', () => {
		const schema = { config: { path: '/route', httpOnly: false } }
		const config = compileCookieConfig(schema as any, {
			path: '/app',
			httpOnly: true,
			domain: 'example.com'
		})

		expect(config.defaults.path).toBe('/route')
		expect(config.defaults.httpOnly).toBe(false)
		expect(config.defaults.domain).toBe('example.com')
	})
})
