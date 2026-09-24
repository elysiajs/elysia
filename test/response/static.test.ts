import { describe, expect, it } from 'bun:test'

import { Elysia, status } from '../../src'

describe('Static Content', () => {
	it('work', async () => {
		const app = new Elysia().get('/', 'Static Content')

		const response = await app.handle('/').then((x) => x.text())

		expect(response).toBe('Static Content')
	})

	it('handle onRequest', async () => {
		const app = new Elysia()
			.request(() => 'request')
			.get('/', 'Static Content')

		const response = await app.handle('/').then((x) => x.text())

		expect(response).toBe('request')
	})

	it('inline life-cycle', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle() {
					return 'beforeHandle'
				}
			},
			'Static Content'
		)

		const response = await app.handle('/').then((x) => x.text())

		expect(response).toBe('beforeHandle')
	})

	it('mutate context', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle({ set }) {
					set.headers['X-Powered-By'] = 'Elysia'
				}
			},
			'Static Content'
		)

		const headers = await app.handle('/').then((x) => x.headers)

		expect(headers.get('X-Powered-By')).toBe('Elysia')
	})

	it('set default header', async () => {
		const app = new Elysia()
			.headers({
				'X-Powered-By': 'Elysia'
			})
			.get('/', 'Static Content')

		const headers = await app.handle('/').then((x) => x.headers)

		expect(headers.get('X-Powered-By')).toBe('Elysia')
	})

	it('handle error thrown from beforeHandle after routing', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle() {
					throw new Error('error')
				},
				error() {
					return 'handled'
				}
			},
			'Static Content'
		)

		const response = await app.handle('/').then((x) => x.text())

		expect(response).toBe('handled')
	})

	it('handle error thrown from request hook before routing', async () => {
		const app = new Elysia()
			.error(() => 'handled')
			.request(() => {
				throw new Error('error')
			})
			.get('/', 'Static Content')

		const response = await app.handle('/').then((x) => x.text())

		expect(response).toBe('handled')
	})

	it('clone content', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle({ set }) {
					set.headers['X-Powered-By'] = 'Elysia'
				}
			},
			'Static Content'
		)

		await app.handle('/')
		await app.handle('/')
		const headers = await app.handle('/').then((x) => x.headers)

		expect(headers.get('X-Powered-By')).toBe('Elysia')
	})
})

// Bun gives a string body its MIME only when it writes the response. Once a
// hook writes `set.headers` (or a cookie), the prepared static Response is
// re-wrapped per request around its body stream, which Bun then serves as
// `application/octet-stream`, so a static `status(code, primitive)` has to
// state the MIME like a bare static primitive does
describe('static status() content-type', () => {
	const values = {
		string: [() => status(201, 'x'), 'text/plain;charset=utf-8'],
		number: [() => status(201, 1), 'text/plain;charset=utf-8'],
		boolean: [() => status(201, true), 'text/plain;charset=utf-8'],
		object: [() => status(201, { a: 1 }), 'application/json;charset=utf-8']
	} as const

	const build = () => {
		let app: any = new Elysia().beforeHandle('global', ({ set }) => {
			set.headers['x-hook'] = '1'
		})
		for (const [name, [make]] of Object.entries(values))
			app = app.get(`/static/${name}`, make()).get(`/fn/${name}`, make)

		return app
	}

	it('states the MIME of a wrapped primitive in process', async () => {
		const app = build()

		for (const [name, [, type]] of Object.entries(values)) {
			const response = await app.handle(`/static/${name}`)
			expect(response.status).toBe(201)
			expect(response.headers.get('content-type')).toBe(type)
		}
	})

	it('serves the function route MIME on a real listener', async () => {
		const app = build().listen(0)

		try {
			for (const [name, [, type]] of Object.entries(values)) {
				const [fn, response] = await Promise.all(
					[`/fn/${name}`, `/static/${name}`].map((path) =>
						fetch(new URL(path, app.server!.url))
					)
				)
				expect(response.status).toBe(201)
				expect(response.headers.get('content-type')).toBe(type)
				expect(response.headers.get('content-type')).toBe(
					fn.headers.get('content-type')
				)
				expect(await response.text()).toBe(await fn.text())
			}
		} finally {
			await app.stop(true)
		}
	})
})
