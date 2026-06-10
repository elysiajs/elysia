import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('guard', () => {
	it('inherits global', async () => {
		const app = new Elysia().state('counter', 0).guard(
			{
				transform: ({ store }) => {
					store.counter++
				}
			},
			(app) =>
				app.get('/', ({ store: { counter } }) => counter, {
					transform: ({ store }) => {
						store.counter++
					}
				})
		)

		const valid = await app.handle(req('/'))

		expect(await valid.text()).toBe('2')
	})

	it('delegate onRequest', async () => {
		const app = new Elysia()
			.get('/', () => 'A')
			.guard({}, (app) =>
				app
					.state('counter', 0)
					.request(({ store }) => {
						store.counter++
					})
					.get('/counter', ({ store: { counter } }) => counter)
			)

		await app.handle(req('/'))
		const res = await app.handle(req('/counter')).then((r) => r.text())

		expect(res).toBe('2')
	})

	it('decorate guard', async () => {
		const app = new Elysia().guard({}, (app) =>
			app.decorate('a', 'b').get('/', ({ a }) => a)
		)

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('b')
	})

	it('validate headers', async () => {
		const app = new Elysia().guard(
			{
				headers: t.Object({
					authorization: t.String()
				})
			},
			(app) => app.get('/', () => 'Hello')
		)

		const error = await app.handle(req('/'))
		const correct = await app.handle(
			new Request('http://localhost/', {
				headers: {
					authorization: 'Bearer'
				}
			})
		)

		expect(correct.status).toBe(200)
		expect(error.status).toBe(422)
	})

	it('validate params', async () => {
		const app = new Elysia().guard(
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

		const error = await app.handle(req('/id/a'))
		const correct = await app.handle(req('/id/1'))

		expect(correct.status).toBe(200)
		expect(error.status).toBe(422)
	})

	it('validate query', async () => {
		const app = new Elysia().guard(
			{
				query: t.Object({
					name: t.String()
				})
			},
			(app) => app.get('/', () => 'Hello')
		)

		const error = await app.handle(req('/?id=1'))
		const correct = await app.handle(req('/?name=a'))

		expect(correct.status).toBe(200)
		expect(error.status).toBe(422)
	})

	it('validate body', async () => {
		const app = new Elysia().guard(
			{
				body: t.Object({
					name: t.String()
				})
			},
			(app) => app.post('/', ({ body }) => body)
		)

		const error = await app.handle(
			post('/', {
				id: 'hi'
			})
		)
		const correct = await app.handle(
			post('/', {
				name: 'hi'
			})
		)

		expect(correct.status).toBe(200)
		expect(error.status).toBe(422)
	})

	it('validate response', async () => {
		const app = new Elysia().guard(
			{
				response: t.String()
			},
			(app) =>
				// @ts-ignore
				app.get('/correct', () => 'Hello').get('/error', () => 1)
		)

		const error = await app.handle(req('/error'))
		const correct = await app.handle(req('/correct'))

		expect(correct.status).toBe(200)
		expect(error.status).toBe(422)
	})

	it('apply guard globally', async () => {
		// @ts-ignore
		const app = new Elysia({ precompile: false })
			.guard({
				response: t.String()
			})
			.get('/correct', () => 'Hello')
			// @ts-expect-error
			.get('/error', () => 1)

		const error = await app.handle(req('/error'))
		const correct = await app.handle(req('/correct'))

		expect(correct.status).toBe(200)
		expect(error.status).toBe(422)
	})

	it('inherits singleton / definitions and re-meregd on main', async () => {
		const app = new Elysia()
			.decorate({ a: 'a' })
			.state({ a: 'a' })
			.model('a', t.String())
			.group('/posts', (app) => {
				expect(Object.keys(app['~ext']?.decorator ?? {})).toEqual(['a'])
				expect(Object.keys(app['~ext']?.store ?? {})).toEqual(['a'])
				expect(Object.keys(app['~ext']?.models ?? {})).toEqual(['a'])

				return app
					.decorate({ b: 'b' })
					.state({ b: 'b' })
					.model('b', t.String())
					.get('/', ({ a }) => a ?? 'Aint no response')
			})

		expect(Object.keys(app['~ext']?.decorator ?? {})).toEqual(['a', 'b'])
		expect(Object.keys(app['~ext']?.store ?? {})).toEqual(['a', 'b'])
		expect(Object.keys(app['~ext']?.models ?? {})).toEqual(['a', 'b'])

		const response = await app.handle(req('/posts')).then((x) => x.text())

		expect(response).toEqual('a')
	})

	it('handle as global', async () => {
		let called = 0

		const inner = new Elysia()
			.guard('global', {
				response: t.Number(),
				transform() {
					called++
				}
			})
			// @ts-expect-error
			.get('/inner', () => 'a')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(called).toBe(3)
		expect(response).toEqual([422, 422, 422])
	})

	// Note: scope is now strictly visibility (per `#use` propagation
	// rules) — not validator override. `.guard()` schemas become
	// STANDALONE validators; every visible one runs as its own pass.
	// Each test below verifies BOTH the propagated global schema AND the
	// more-local schema run, so a response that satisfies one but fails
	// the other still 422s.
	it('handle as global without local override', async () => {
		let called = 0

		const inner = new Elysia()
			.guard('global', {
				response: t.Number(),
				transform() {
					called++
				}
			})
			// @ts-expect-error
			.get('/inner', () => 'a')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.guard({
				response: t.Boolean(),
				transform() {
					called++
				}
			})
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(called).toBe(4)
		// `/plugin` returns `true` — passes Boolean but fails Number.
		// Both run, so the route 422s on the Number constraint.
		expect(response).toEqual([422, 422, 422])
	})

	it('handle as global without scoped override', async () => {
		let called = 0

		const inner = new Elysia()
			.guard('global', {
				response: t.Number(),
				transform() {
					called++
				}
			})
			// @ts-expect-error
			.get('/inner', () => 'a')

		const plugin = new Elysia()
			.use(inner)
			.guard('plugin', {
				response: t.String(),
				transform() {
					called++
				}
			})
			.get('/plugin', () => 'ok')

		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(called).toBe(5)
		// `/plugin` returns `'ok'` (string) — passes String but fails
		// Number. `/` returns 'not a number' — passes String (plugin
		// scope reaches app), fails Number.
		expect(response).toEqual([422, 422, 422])
	})

	it('handle as scoped', async () => {
		let called = 0

		const inner = new Elysia()
			.guard('plugin', {
				response: t.Number(),
				transform() {
					called++
				}
			})
			// @ts-expect-error
			.get('/inner', () => 'a')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)

		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(called).toBe(2)
		expect(response).toEqual([422, 422, 200])
	})

	it('handle as local', async () => {
		let called = 0

		const inner = new Elysia()
			.guard('local', {
				response: t.Number(),
				transform() {
					called++
				}
			})
			// @ts-expect-error
			.get('/inner', () => 'a')

		const plugin = new Elysia().use(inner).get('/plugin', () => true)

		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(called).toBe(1)
		expect(response).toEqual([422, 200, 200])
	})

	it('only cast guard', async () => {
		let called = 0

		const plugin = new Elysia()
			.guard('plugin', {
				response: t.Number(),
				transform() {
					called++
				}
			})
			.transform(() => {
				called++
			})
			// @ts-expect-error
			.get('/inner', () => 'a')

		const app = new Elysia().use(plugin).get('/', () => 1)

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(called).toBe(3)
		expect(response).toEqual([422, 200])
	})

	it('handle merge guard and hook on non-specified responses status', () => {
		const app = new Elysia()
			.guard({
				response: {
					400: t.String(),
					500: t.String()
				}
			})
			.get('/', () => '', {
				response: t.String()
			})

		expect(Object.keys(app.routes[0].hooks.response)).toEqual([
			'200',
			'400',
			'500'
		])
	})

	it('cast callback function schema to standaloneValidator', async () => {
		const app = new Elysia().guard(
			{ params: t.Object({ id: t.Number() }) },
			(app) =>
				app.get('/guard/:id/:name', ({ params }) => params, {
					params: t.Object({ name: t.String() })
				})
		)

		const valid = app.handle(req('/guard/1/saltyaom')).then((x) => x.json())
		const invalid = app
			.handle(req('/guard/a/saltyaom'))
			.then((x) => x.status)

		expect(await valid).toEqual({ id: 1, name: 'saltyaom' })
		expect(await invalid).toBe(422)
	})

	it('handle multiple nested guard with schema', async () => {
		const app = new Elysia().guard(
			{
				query: t.Object({
					name: t.Literal('lilith')
				})
			},
			(app) =>
				app.guard(
					{
						query: t.Object({
							limit: t.Number()
						})
					},
					(app) =>
						app.get('/', ({ query }) => query, {
							query: t.Object({
								playing: t.Boolean()
							})
						})
				)
		)

		const value = await app
			.handle(req('/?name=lilith&playing=true&limit=10'))
			.then((x) => x.json())

		expect(value).toEqual({
			name: 'lilith',
			playing: true,
			limit: 10
		})

		const error = await app
			.handle(req('/?name=lilith&playing=true'))
			.then((x) => x.status)

		expect(error).toBe(422)
	})
})
