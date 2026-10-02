import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

// A session plugin that writes `set-cookie` as a raw string must not lose its
// cookie when the handler also writes through the cookie jar
describe('raw set-cookie header next to the cookie jar', () => {
	it('keeps a raw string set by an earlier hook', async () => {
		const app = new Elysia()
			.beforeHandle(({ set }) => {
				set.headers['set-cookie'] = 'session=from-plugin; Path=/'
			})
			.get('/', ({ cookie: { theme } }) => {
				theme.value = 'dark'

				return 'ok'
			})

		const res = await app.handle(new Request('http://localhost/'))

		expect(res.headers.getSetCookie()).toEqual([
			'session=from-plugin; Path=/',
			'theme=dark; Path=/'
		])
	})

	it('keeps a raw string set in the handler', async () => {
		const app = new Elysia().get('/', ({ set, cookie: { theme } }) => {
			set.headers['set-cookie'] = 'a=1'
			theme.value = 'dark'

			return 'ok'
		})

		const res = await app.handle(new Request('http://localhost/'))

		expect(res.headers.getSetCookie()).toEqual(['a=1', 'theme=dark; Path=/'])
	})

	// Streaming lanes map `set` twice; the jar cookie must not repeat
	it('does not repeat cookies on streaming lanes', async () => {
		const app = new Elysia().get('/', function* ({ set, cookie: { jar } }) {
			set.headers['set-cookie'] = 'raw=1'
			jar.value = 'j'
			yield 'a'
		})

		const res = await app.handle(new Request('http://localhost/'))
		await res.text()

		expect(res.headers.getSetCookie()).toEqual(['raw=1', 'jar=j; Path=/'])
	})
})
