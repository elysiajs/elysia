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
		expect(error.status).toBe(422)
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
		expect(error.status).toBe(422)
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
		expect(error.status).toBe(422)
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
		expect(error.status).toBe(422)
	})

	it('validate response', async () => {
		const app = new Elysia().group(
			'/v1',
			{
				response: t.String()
			},
			(app) =>
				// @ts-ignore
				app
					.get('/correct', () => 'Hello')
					// @ts-ignore
					.get('/error', () => 1)
		)

		const error = await app.handle(req('/v1/error'))
		const correct = await app.handle(req('/v1/correct'))

		expect(correct.status).toBe(200)
		expect(error.status).toBe(422)
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

		expect(app.router.history.map((x) => x.path)).toEqual([
			'/v1/course',
			'/v1/course/new',
			'/v1/course/id/:courseId/chapter/hello'
		])
	})

	it("skip don't duplicate prefix on group with hooks", () => {
		const a = new Elysia({ prefix: '/course' }).group(
			'/id/:courseId',
			{
				params: t.Object({
					courseId: t.Numeric()
				})
			},
			(app) => app.get('/b', () => 'A')
		)

		const b = new Elysia({ prefix: '/test' }).group(
			'/id/:courseId',
			(app) => app.get('/b', () => 'A')
		)

		const app = new Elysia()
			.use(a)
			.use(b)
			.get('/', () => 'a')

		expect(app.router.history.map((x) => x.path)).toEqual([
			'/course/id/:courseId/b',
			'/test/id/:courseId/b',
			'/'
		])
	})

	it('inherits singleton / definitions and re-meregd on main', async () => {
		const app = new Elysia()
			.decorate({ a: 'a' })
			.state({ a: 'a' })
			.model('a', t.String())
			.error('a', Error)
			.group('/posts', (app) => {
				// @ts-expect-error
				expect(Object.keys(app.singleton.decorator)).toEqual(['a'])
				// @ts-expect-error
				expect(Object.keys(app.singleton.store)).toEqual(['a'])
				// @ts-expect-error
				expect(Object.keys(app.definitions.type)).toEqual(['a'])
				// @ts-expect-error
				expect(Object.keys(app.definitions.error)).toEqual(['a'])

				return app
					.decorate({ b: 'b' })
					.state({ b: 'b' })
					.model('b', t.String())
					.error('b', Error)
					.get('/', ({ a }) => a ?? 'Aint no response')
			})

		// @ts-expect-error
		expect(Object.keys(app.singleton.decorator)).toEqual(['a', 'b'])
		// @ts-expect-error
		expect(Object.keys(app.singleton.store)).toEqual(['a', 'b'])
		// @ts-expect-error
		expect(Object.keys(app.definitions.type)).toEqual(['a', 'b'])
		// @ts-expect-error
		expect(Object.keys(app.definitions.error)).toEqual(['a', 'b'])

		const response = await app.handle(req('/posts')).then((x) => x.text())

		expect(response).toEqual('a')
	})
})
