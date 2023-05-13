import { Elysia, InternalServerError, NotFoundError, t } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

const request = new Request('http://localhost:8080')

describe('Handle Error', () => {
	it('handle NOT_FOUND', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			.handleError(request, new NotFoundError(), {
				headers: {}
			})

		expect(await res.text()).toBe('NOT_FOUND')
		expect(res.status).toBe(404)
	})

	it('handle INTERNAL_SERVER_ERROR', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			.handleError(request, new InternalServerError(), {
				headers: {}
			})

		expect(await res.text()).toBe('INTERNAL_SERVER_ERROR')
		expect(res.status).toBe(500)
	})

	it('handle VALIDATION', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi', {
				query: t.Object({
					name: t.String()
				})
			})
			.handle(req('/'))

		expect(res.status).toBe(400)
	})

	it('handle custom error', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			.handleError(request, new Error("I'm a teapot"), {
				headers: {}
			})

		expect(await res.text()).toBe("I'm a teapot")
		expect(res.status).toBe(500)
	})

	it('use custom error', async () => {
		const res = await new Elysia()
			.get('/', () => 'Hi')
			.onError(({ code }) => {
				if (code === 'NOT_FOUND')
					return new Response("I'm a teapot", {
						status: 418
					})
			})
			.handle(req('/not-found'))

		expect(await res.text()).toBe("I'm a teapot")
		expect(res.status).toBe(418)
	})

	it('inject headers to error', async () => {
		const app = new Elysia()
			.onRequest(({ set }) => {
				set.headers['Access-Control-Allow-Origin'] = '*'
			})
			.get('/', () => {
				throw new NotFoundError()
			})

		const res = await app.handle(req('/'))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
		expect(res.status).toBe(404)
	})

	it('transform any to error', async () => {
		const app = new Elysia()
			.get('/', () => {
				throw new NotFoundError()
			})
			.onError(async ({ set }) => {
				set.status = 418

				return 'aw man'
			})

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('aw man')
		expect(res.status).toBe(418)
	})

	it('handle error in group', async () => {
		const authenticate = (app: Elysia) =>
			app.group('/group', (group) =>
				group
					.get('/inner', () => {
						throw new Error('A')
					})
					.onError(() => {
						return 'handled'
					})
			)

		const app = new Elysia().use(authenticate)

		const response = await app.handle(req('/group/inner'))

		expect(await response.text()).toEqual('handled')
		expect(response.status).toEqual(500)
	})

	it('handle error status in group', async () => {
		const authenticate = (app: Elysia) =>
			app.group('/group', (group) =>
				group
					.get('/inner', ({ set }) => {
						set.status = 418

						throw new Error('A')
					})
					.onError(() => {
						return 'handled'
					})
			)

		const app = new Elysia().use(authenticate)

		const response = await app.handle(req('/group/inner'))

		expect(await response.text()).toEqual('handled')
		expect(response.status).toEqual(418)
	})
})
