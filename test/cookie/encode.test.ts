import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

describe('Cookie encode/decode', () => {
	it('should use custom encode function for cookie values', async () => {
		const customEncode = (value: string) =>
			Buffer.from(value).toString('base64')

		const app = new Elysia({ cookie: { encode: customEncode } }).get(
			'/',
			({ cookie: { session } }) => {
				session.value = 'hello-world'
				return 'ok'
			}
		)

		const response = await app.handle(new Request('http://localhost/'))
		const setCookie = response.headers.get('set-cookie')

		expect(setCookie).toBeDefined()
		// The value should be base64 encoded by our custom encoder
		expect(setCookie).toContain(
			'session=' + Buffer.from('hello-world').toString('base64')
		)
	})

	it('should use custom decode function for cookie values', async () => {
		const customDecode = (value: string) =>
			Buffer.from(value, 'base64').toString('utf-8')

		const app = new Elysia({ cookie: { decode: customDecode } }).get(
			'/',
			({ cookie: { session } }) => {
				return session.value ?? 'empty'
			}
		)

		// Send a base64-encoded cookie value
		const encoded = Buffer.from('decoded-value').toString('base64')
		const response = await app.handle(
			new Request('http://localhost/', {
				headers: { cookie: `session=${encoded}` }
			})
		)

		const text = await response.text()
		expect(text).toBe('decoded-value')
	})

	it('should use paired encode/decode functions', async () => {
		const customEncode = (value: string) =>
			Buffer.from(value).toString('base64')
		const customDecode = (value: string) =>
			Buffer.from(value, 'base64').toString('utf-8')

		const app = new Elysia({
			cookie: {
				encode: customEncode,
				decode: customDecode
			}
		})
			.get('/set', ({ cookie: { data } }) => {
				data.value = 'round-trip'
				return 'ok'
			})
			.get('/get', ({ cookie: { data } }) => {
				return data.value ?? 'empty'
			})

		// Set cookie
		const setResponse = await app.handle(
			new Request('http://localhost/set')
		)
		const setCookie = setResponse.headers.get('set-cookie')!
		expect(setCookie).toContain(
			'data=' + Buffer.from('round-trip').toString('base64')
		)

		// Get cookie using the encoded value
		const getResponse = await app.handle(
			new Request('http://localhost/get', {
				headers: { cookie: setCookie.split(';')[0] }
			})
		)
		expect(await getResponse.text()).toBe('round-trip')
	})

	it('should work without custom encode/decode (default behavior)', async () => {
		const app = new Elysia().get('/', ({ cookie: { test } }) => {
			test.value = 'hello world'
			return 'ok'
		})

		const response = await app.handle(new Request('http://localhost/'))
		const setCookie = response.headers.get('set-cookie')
		expect(setCookie).toBeDefined()
		// Default encodeURIComponent encodes spaces
		expect(setCookie).toContain('test=hello%20world')
	})

	it('should use identity encode to skip encoding', async () => {
		const app = new Elysia({
			cookie: { encode: (v: string) => v }
		}).get('/', ({ cookie: { test } }) => {
			test.value = 'hello-world'
			return 'ok'
		})

		const response = await app.handle(new Request('http://localhost/'))
		const setCookie = response.headers.get('set-cookie')
		expect(setCookie).toBeDefined()
		// Identity encoder passes value through unchanged
		expect(setCookie).toContain('test=hello-world')
	})

	it('should propagate encode through route-level cookie config', async () => {
		const customEncode = (value: string) => value.toUpperCase()

		const app = new Elysia({ cookie: { encode: customEncode } }).get(
			'/',
			({ cookie: { name } }) => {
				name.value = 'alice'
				return 'ok'
			}
		)

		const response = await app.handle(new Request('http://localhost/'))
		const setCookie = response.headers.get('set-cookie')
		expect(setCookie).toContain('name=ALICE')
	})

	it('should work with JSON cookie values and custom encode', async () => {
		const customEncode = (value: string) =>
			Buffer.from(value).toString('base64')

		const app = new Elysia({ cookie: { encode: customEncode } }).get(
			'/',
			({ cookie: { data } }) => {
				data.value = { key: 'value' }
				return 'ok'
			}
		)

		const response = await app.handle(new Request('http://localhost/'))
		const setCookie = response.headers.get('set-cookie')
		expect(setCookie).toBeDefined()
		// JSON stringify then base64 encode
		const expected = Buffer.from(
			JSON.stringify({ key: 'value' })
		).toString('base64')
		expect(setCookie).toContain(`data=${expected}`)
	})

	it('should work with custom decode on non-encoded values', async () => {
		// custom decode that handles plain text
		const customDecode = (value: string) => value + '-decoded'

		const app = new Elysia({ cookie: { decode: customDecode } }).get(
			'/',
			({ cookie: { name } }) => {
				return name.value ?? 'empty'
			}
		)

		const response = await app.handle(
			new Request('http://localhost/', {
				headers: { cookie: 'name=alice' }
			})
		)

		expect(await response.text()).toBe('alice-decoded')
	})

	it('should use custom encode in plugin composition', async () => {
		const customEncode = (value: string) =>
			value.split('').reverse().join('')

		const plugin = new Elysia().get(
			'/plugin',
			({ cookie: { session } }) => {
				session.value = 'hello'
				return 'ok'
			}
		)

		const app = new Elysia({ cookie: { encode: customEncode } }).use(
			plugin
		)

		const response = await app.handle(
			new Request('http://localhost/plugin')
		)
		const setCookie = response.headers.get('set-cookie')
		expect(setCookie).toContain('session=olleh')
	})

	it('should use custom encode in dynamic mode', async () => {
		const customEncode = (value: string) => value.toUpperCase()

		const app = new Elysia({
			aot: false,
			cookie: { encode: customEncode }
		}).get('/', ({ cookie: { test } }) => {
			test.value = 'lower'
			return 'ok'
		})

		const response = await app.handle(new Request('http://localhost/'))
		const setCookie = response.headers.get('set-cookie')
		expect(setCookie).toContain('test=LOWER')
	})

	it('should use custom decode in dynamic mode', async () => {
		const customDecode = (value: string) => value.toLowerCase()

		const app = new Elysia({
			aot: false,
			cookie: { decode: customDecode }
		}).get('/', ({ cookie: { name } }) => {
			return name.value ?? 'empty'
		})

		const response = await app.handle(
			new Request('http://localhost/', {
				headers: { cookie: 'name=UPPERCASE' }
			})
		)

		expect(await response.text()).toBe('uppercase')
	})
})
