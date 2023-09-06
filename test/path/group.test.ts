import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { post, req } from '../utils'

describe('group', () => {
	it('delegate onRequest', async () => {
		const app = new Elysia()
			.get('/', () => 'A')
			.group('/counter', (app) =>
				app
					.state('counter', 0)
					.onRequest(({ store }) => {
						store.counter++
					})
					.get('', ({ store: { counter } }) => counter)
			)

		await app.handle(req('/'))
		const res = await app.handle(req('/counter')).then((r) => r.text())

		expect(res).toBe('2')
	})

	it('decorate group', async () => {
		const app = new Elysia().group('/v1', (app) =>
			app.decorate('a', 'b').get('/', ({ a }) => a)
		)

		const res = await app.handle(req('/v1/')).then((x) => x.text())

		expect(res).toBe('b')
	})

	it('validate headers', async () => {
		const app = new Elysia().group(
			'/v1',
			{
				headers: t.Object({
					authorization: t.String()
				})
			},
			(app) => app.get('', () => 'Hello')
		)

		const error = await app.handle(req('/v1'))
		const correct = await app.handle(
			new Request('http://localhost/v1', {
				headers: {
					authorization: 'Bearer'
				}
			})
		)

		expect(correct.status).toBe(200)
		expect(error.status).toBe(400)
	})

	it('validate params', async () => {
		const app = new Elysia().group(
			'/v1',
			{
				transform({ params }) {
					if (!+Number.isNaN(params.id)) params.id = +params.id
				},
				params: t.Object({
					id: t.Number()
				})
			},
			(app) => app.get('/id/:id', () => 'Hello')
		)

		const error = await app.handle(req('/v1/id/a'))
		const correct = await app.handle(req('/v1/id/1'))

		expect(correct.status).toBe(200)
		expect(error.status).toBe(400)
	})

	it('validate query', async () => {
		const app = new Elysia().group(
			'/v1',
			{
				query: t.Object({
					name: t.String()
				})
			},
			(app) => app.get('', () => 'Hello')
		)

		const error = await app.handle(req('/v1?id=1'))
		const correct = await app.handle(req('/v1?name=a'))

		expect(correct.status).toBe(200)
		expect(error.status).toBe(400)
	})

	it('validate body', async () => {
		const app = new Elysia().group(
			'/v1',
			{
				body: t.Object({
					name: t.String()
				})
			},
			(app) => app.post('', ({ body }) => body)
		)

		const error = await app.handle(
			post('/v1', {
				id: 'hi'
			})
		)
		const correct = await app.handle(
			post('/v1', {
				name: 'hi'
			})
		)

		expect(correct.status).toBe(200)
		expect(error.status).toBe(400)
	})

	it('validate response', async () => {
		const app = new Elysia().group(
			'/v1',
			{
				response: t.String()
			},
			(app) =>
				app
					.get('/correct', () => 'Hello')
					// @ts-ignore
					.get('/error', () => 1)
		)

		const error = await app.handle(req('/v1/error'))
		const correct = await app.handle(req('/v1/correct'))

		expect(correct.status).toBe(200)
		expect(error.status).toBe(400)
	})

	it('validate request with prefix', async () => {
		const app = new Elysia({ prefix: '/api' }).group('/v1', (app) =>
			app.get('', () => 'Hello')
		)

		const res = await app.handle(req('/api/v1'))

		expect(res.status).toBe(200)
	})

	it('handle nested prefix with group', () => {
		const plugin = new Elysia({ prefix: '/v1' }).group('/course', (app) =>
			app
				.get('', () => '')
				.put('/new', () => '')
				.group(
					'/id/:courseId',
					{
						params: t.Object({
							courseId: t.Numeric()
						})
					},
					(app) =>
						app.group('/chapter', (app) =>
							app.get(
								'/hello',
								({ params: { courseId } }) => courseId
							)
						)
				)
		)

		const app = new Elysia().use(plugin)

		expect(app.routes.map((x) => x.path)).toEqual([
			'/v1/course',
			'/v1/course/new',
			'/v1/course/id/:courseId/chapter/hello'
		])
	})
})
