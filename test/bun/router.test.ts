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
})
