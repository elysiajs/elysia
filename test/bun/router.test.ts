import { describe, it, expect } from 'bun:test'
import { Elysia, ELYSIA_REQUEST_ID, t } from '../../src'
import { req } from '../utils'

describe('Bun router', () => {
	it('works', async () => {
		let trace = false
		let wrapped = false
		let onRequest = false
		let traceOnRequest = false

		const app = new Elysia({ systemRouter: true })
			.trace(({ onHandle, onRequest }) => {
				onRequest(() => {
					traceOnRequest = true
				})

				onHandle(() => {
					trace = true
				})
			})
			.onRequest(() => {
				onRequest = true
			})
			.decorate('decorated', 'decorated')
			.state('state', 'state')
			.derive(() => ({ derived: 'derived' }))
			.resolve(() => ({ resolved: 'resolved' }))
			.get('/', ({ store, decorated, derived, resolved }) => ({
				store,
				decorated,
				derived,
				resolved
			}))
			.wrap((fn) => {
				wrapped = true

				return fn
			})
			.listen(0)

		const response = await fetch(
			`http://localhost:${app.server!.port}`
		).then((x) => x.json())

		expect(response).toEqual({
			store: {
				state: 'state'
			},
			decorated: 'decorated',
			derived: 'derived',
			resolved: 'resolved'
		})

		expect(wrapped).toEqual(true)
		expect(trace).toBe(true)
		expect(onRequest).toBe(true)
		expect(traceOnRequest).toBe(true)
	})

	it('handle params and query', async () => {
		const app = new Elysia({ systemRouter: true })
			.get('/id/:id', ({ query, params }) => ({
				query,
				params
			}))
			.listen(0)

		const query = await fetch(
			`http://localhost:${app.server!.port}/id/1?q=s`
		).then((x) => x.json())

		expect(query).toEqual({
			query: {
				q: 's'
			},
			params: {
				id: '1'
			}
		})
	})

	it('handle optional params', async () => {
		const app = new Elysia({ systemRouter: false })
			.get('/id/:id?/:name?', ({ params }) => params)
			.listen(0)

		const query = await Promise.all([
			fetch(`http://localhost:${app.server!.port}/id`).then((x) =>
				x.json()
			),
			fetch(`http://localhost:${app.server!.port}/id/1`).then((x) =>
				x.json()
			),
			fetch(`http://localhost:${app.server!.port}/id/1/saltyaom`).then(
				(x) => x.json()
			)
		])

		expect(query).toEqual([{}, { id: '1' }, { id: '1', name: 'saltyaom' }])
	})

	it('handle async static route', async () => {
		const app = new Elysia()
			.get(
				'/',
				Promise.resolve(
					new Response(`<h1>Hello World</h1>`, {
						headers: {
							'Content-Type': 'text/html'
						}
					})
				)
			)
			.listen(0)

		await Bun.sleep(20)

		const response = await fetch(
			`http://localhost:${app.server!.port}`
		).then((x) => x.text())

		expect(response).toEqual('<h1>Hello World</h1>')
	})

	it('handle mount', async () => {
		const app = new Elysia()
			.mount((request: Request) => new Response(request.url))
			.mount('/prefix', (request: Request) => new Response(request.url))
			.listen(0)

		const response = await Promise.all([
			fetch(`http://localhost:${app.server?.port}/a`),
			fetch(`http://localhost:${app.server?.port}/prefix/a`)
		])

		expect(response[0].status).toBe(200)
		expect(response[1].status).toBe(200)
	})

	it('handle trace url', async () => {
		let url = ''
		let hasRequestId = false

		const app = new Elysia()
			.trace((a) => {
				a.onHandle(() => {
					// @ts-expect-error private property
					url = a.context.url

					// @ts-expect-error private property
					hasRequestId = !!a.context[ELYSIA_REQUEST_ID]
				})
			})
			.get('/', () => 'ok')
			.listen(0)

		await fetch(`http://localhost:${app.server!.port}/`)

		expect(url).toBe(`http://localhost:${app.server!.port}/`)
		expect(hasRequestId).toBe(true)
	})

	it('handle wrap in mount', async () => {
		let url = ''
		let hasWrap = false

		const app = new Elysia()
			.wrap((fn) => {
				hasWrap = true

				return fn
			})
			.mount('/', (request) => new Response((url = request.url)))
			.listen(0)

		await fetch(`http://localhost:${app.server!.port}/`)

		expect(url).toBe(`http://localhost:${app.server!.port}/`)
		expect(hasWrap).toBe(true)
	})

	it('handle trace url with wrap', async () => {
		let url = ''
		let hasRequestId = false
		let hasWrap = false

		const app = new Elysia()
			.wrap((fn) => {
				hasWrap = true

				return fn
			})
			.trace((a) => {
				a.onHandle(() => {
					// @ts-expect-error private property
					url = a.context.url

					// @ts-expect-error private property
					hasRequestId = !!a.context[ELYSIA_REQUEST_ID]
				})
			})
			.get('/', () => 'ok')
			.listen(0)

		await fetch(`http://localhost:${app.server!.port}/`)

		expect(url).toBe(`http://localhost:${app.server!.port}/`)
		expect(hasWrap).toBe(true)
		expect(hasRequestId).toBe(true)
	})

	it('handle mount', async () => {
		let url = ''
		let hasRequestId = false
		let hasWrap = false

		const app = new Elysia()
			.wrap((fn) => {
				hasWrap = true

				return fn
			})
			.trace((a) => {
				a.onHandle(() => {
					// @ts-expect-error private property
					url = a.context.url

					// @ts-expect-error private property
					hasRequestId = !!a.context[ELYSIA_REQUEST_ID]
				})
			})
			.get('/', () => 'ok')
			.listen(0)

		await fetch(`http://localhost:${app.server!.port}/`)

		expect(url).toBe(`http://localhost:${app.server!.port}/`)
		expect(hasWrap).toBe(true)
		expect(hasRequestId).toBe(true)
	})

	it('handle async plugin', async () => {
		const asyncPlugin = async () =>
			new Elysia({ name: 'async' })
				.get('/router', () => 'OK')
				.get('/static', 'OK')

		const app = new Elysia({ name: 'main' }).use(asyncPlugin).listen(0)

		const [router, _static] = await Promise.all([
			fetch(`http://localhost:${app.server?.port}/router`).then((x) =>
				x.text()
			),
			fetch(`http://localhost:${app.server?.port}/static`).then((x) =>
				x.text()
			)
		])

		expect(router).toBe('OK')
		expect(_static).toBe('OK')
	})

	it('handle async request', async () => {
		const app = new Elysia()
			.onRequest(async () => {})
			.mount('/auth', () => new Response('OK'))
			.listen(0)

		const response = await fetch(
			`http://localhost:${app.server?.port}/auth`
		).then((x) => x.text())

		expect(response).toBe('OK')
	})

	it('handle wildcard', async () => {
		const app = new Elysia()
			.get('/hi/:id', ({ params }) => params)
			.get('/hi/*', ({ params }) => params)
			.listen(0)

		const [response1, response2] = await Promise.all([
			fetch(
				`http://${app.server?.hostname}:${app.server?.port}/hi/saltyaom`
			).then((x) => x.json()),
			fetch(
				`http://${app.server?.hostname}:${app.server?.port}/hi/salty/aom`
			).then((x) => x.json())
		])

		expect(response1).toEqual({
			id: 'saltyaom'
		})

		expect(response2).toEqual({
			'*': 'salty/aom'
		})
	})

	it('mapEarlyResponse onRequest', async () => {
		const app = new Elysia()
			.onRequest(() => 'OK!! XD')
			.get('/', () => '')
			.listen(0)

		const response = await fetch(
			`http://localhost:${app.server?.port}/auth`
		).then((x) => x.text())

		expect(response).toBe('OK!! XD')
	})
})
