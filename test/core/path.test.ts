import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('handle path with spaces', () => {
	it('treat static route paths as data', async () => {
		const path = "/pages/o'brien"
		const app = new Elysia().get(path, () => 'ok')

		const response = await app.handle(
			new Request(`http://localhost${path}`)
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ok')
	})

	it('treat dynamic route paths as data', async () => {
		const marker = '__elysiaDynamicRouteCodegen'
		const path = `/pages/x\`;globalThis.${marker}=true;c.route=\`y`

		delete (globalThis as Record<string, unknown>)[marker]

		const app = new Elysia().get(path, ({ route }) => route)
		const response = await app.handle(
			new Request(
				`http://localhost${encodeURIComponent(path).replace(/%2F/g, '/')}`
			)
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(path)
		expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined()
	})

	it('treat custom methods as data', async () => {
		const app = new Elysia()
			.route("X'Y", '/custom-method', () => 'custom')
			.get('/health', () => 'ok')
		const response = await app.handle(
			new Request('http://localhost/health')
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ok')
	})

	it('AOT on: static path', async () => {
		const PATH = '/y a y'

		const app = new Elysia().get(
			PATH,
			() => 'result from a path wirh spaces'
		)

		const response = await app.handle(
			new Request(`http://localhost${PATH}`)
		)

		expect(response.status).toBe(200)
	})

	it('AOT off: static path', async () => {
		const PATH = '/y a y'

		const app = new Elysia({ aot: false }).get(
			PATH,
			() => 'result from a path wirh spaces'
		)

		const response = await app.handle(
			new Request(`http://localhost${PATH}`)
		)

		expect(response.status).toBe(200)
	})

	it('AOT on: dynamic path', async () => {
		const app = new Elysia().get('/y a y/:id', ({ params: { id } }) => id)

		const response = await app.handle(
			new Request(`http://localhost/y a y/1`)
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('1')
	})

	it('AOT off: dynamic path', async () => {
		const app = new Elysia({ aot: false }).get(
			'/y a y/:id',
			({ params: { id } }) => id
		)

		const response = await app.handle(
			new Request(`http://localhost/y a y/1`)
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('1')
	})

	it('AOT on: optional dynamic path', async () => {
		const app = new Elysia().get(
			'/y a y/:id?',
			({ params: { id } }) => id ?? 0
		)

		const response = await Promise.all(
			[
				new Request(`http://localhost/y a y`),
				new Request(`http://localhost/y a y/1`)
			].map(app.handle)
		)

		expect(response[0].status).toBe(200)
		expect(response[1].status).toBe(200)

		const value = await Promise.all(response.map((x) => x.text()))

		expect(value[0]).toBe('0')
		expect(value[1]).toBe('1')
	})

	it('AOT off: optional dynamic path', async () => {
		const app = new Elysia({ aot: false }).get(
			'/y a y/:id?',
			({ params: { id } }) => id ?? 0
		)

		const response = await Promise.all(
			[
				new Request(`http://localhost/y a y`),
				new Request(`http://localhost/y a y/1`)
			].map(app.handle)
		)

		expect(response[0].status).toBe(200)
		expect(response[1].status).toBe(200)

		const value = await Promise.all(response.map((x) => x.text()))

		expect(value[0]).toBe('0')
		expect(value[1]).toBe('1')
	})

	it('handle optional path parameters after required', async () => {
		const app = new Elysia().get(
			'/api/:required/:optional?',
			({ params }) => params.required
		)

		const required = await app.handle(
			new Request('http://localhost/api/yay')
		)

		expect(required.status).toBe(200)
		expect(await required.text()).toEqual('yay')

		const optional = await app.handle(
			new Request('http://localhost/api/yay/ok')
		)

		expect(optional.status).toBe(200)
		expect(await optional.text()).toEqual('yay')
	})
})

describe('encoded path separators', () => {
	for (const aot of [true, false])
		it(`preserves encoded slashes in named params with AOT ${aot ? 'on' : 'off'}`, async () => {
			const app = new Elysia({ aot })
				.get('/file/:name/end', ({ params }) => params.name)
				.get('/wild/*', ({ params }) => params['*'])

			const values = await Promise.all(
				[
					'/file/a%20b%2Fc/end',
					'/file/a%2fb/end',
					'/file/%2e%2e%2fsecret/end',
					'/file/a%252Fb/end',
					'/file/a%20b/end',
					'/wild/a%2Fb'
				].map((path) =>
					app
						.handle(new Request(`http://localhost${path}`))
						.then((response) => response.text())
				)
			)

			expect(values).toEqual([
				'a b%2Fc',
				'a%2fb',
				'..%2fsecret',
				'a%2Fb',
				'a b',
				'a%2Fb'
			])
		})
})
