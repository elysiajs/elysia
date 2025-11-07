import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('getFlattenedRoutes', () => {
	it('merges guard standaloneValidator into direct properties', () => {
		const app = new Elysia().guard(
			{
				body: t.Object({
					username: t.String(),
					password: t.String()
				})
			},
			(app) =>
				app
					.post('/sign-up', ({ body }) => body)
					.post('/sign-in', ({ body }) => body)
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const signUpRoute = flatRoutes.find((r) => r.path === '/sign-up')
		const signInRoute = flatRoutes.find((r) => r.path === '/sign-in')

		expect(signUpRoute).toBeDefined()
		expect(signInRoute).toBeDefined()

		// Check that body schema exists in hooks
		expect(signUpRoute?.hooks.body).toBeDefined()
		expect(signInRoute?.hooks.body).toBeDefined()

		// Verify it's an object schema with the expected properties
		expect(signUpRoute?.hooks.body.type).toBe('object')
		expect(signUpRoute?.hooks.body.properties).toHaveProperty('username')
		expect(signUpRoute?.hooks.body.properties).toHaveProperty('password')
	})

	it('returns original route when no standaloneValidator', () => {
		const app = new Elysia().get('/', () => 'hi')

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()
		// @ts-expect-error - accessing protected method for testing
		const normalRoutes = app.getGlobalRoutes()

		expect(flatRoutes.length).toBe(normalRoutes.length)
		expect(flatRoutes[0]).toBe(normalRoutes[0])
	})

	it('merges nested guard schemas', () => {
		const app = new Elysia().guard(
			{
				headers: t.Object({
					authorization: t.String()
				})
			},
			(app) =>
				app.guard(
					{
						body: t.Object({
							data: t.String()
						})
					},
					(app) => app.post('/nested', ({ body }) => body)
				)
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const nestedRoute = flatRoutes.find((r) => r.path === '/nested')

		expect(nestedRoute).toBeDefined()
		expect(nestedRoute?.hooks.headers).toBeDefined()
		expect(nestedRoute?.hooks.body).toBeDefined()
	})

	it('merges guard schema with direct route schema', () => {
		const app = new Elysia().guard(
			{
				headers: t.Object({
					'x-api-key': t.String()
				})
			},
			(app) =>
				app.post('/mixed', ({ body }) => body, {
					body: t.Object({
						name: t.String()
					})
				})
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const mixedRoute = flatRoutes.find((r) => r.path === '/mixed')

		expect(mixedRoute).toBeDefined()
		expect(mixedRoute?.hooks.headers).toBeDefined()
		expect(mixedRoute?.hooks.body).toBeDefined()

		// Both guard and direct schemas should be present
		expect(mixedRoute?.hooks.headers.type).toBe('object')
		expect(mixedRoute?.hooks.body.type).toBe('object')
	})

	it('handles query and params schemas from guard', () => {
		const app = new Elysia().guard(
			{
				query: t.Object({
					page: t.String()
				}),
				params: t.Object({
					id: t.String()
				})
			},
			(app) => app.get('/items/:id', ({ params, query }) => ({ params, query }))
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const itemRoute = flatRoutes.find((r) => r.path === '/items/:id')

		expect(itemRoute).toBeDefined()
		expect(itemRoute?.hooks.query).toBeDefined()
		expect(itemRoute?.hooks.params).toBeDefined()
	})

	it('handles cookie schemas from guard', () => {
		const app = new Elysia().guard(
			{
				cookie: t.Object({
					session: t.String()
				})
			},
			(app) => app.get('/profile', ({ cookie }) => cookie)
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const profileRoute = flatRoutes.find((r) => r.path === '/profile')

		expect(profileRoute).toBeDefined()
		expect(profileRoute?.hooks.cookie).toBeDefined()
	})

	it('handles response schemas from guard', () => {
		const app = new Elysia().guard(
			{
				response: {
					200: t.Object({
						success: t.Boolean()
					})
				}
			},
			(app) => app.get('/status', () => ({ success: true }))
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const statusRoute = flatRoutes.find((r) => r.path === '/status')

		expect(statusRoute).toBeDefined()
		expect(statusRoute?.hooks.response).toBeDefined()
		expect(statusRoute?.hooks.response[200]).toBeDefined()
	})

	it('merges status-code map response with plain schema without data loss', () => {
		// Test case for the coderabbitai feedback - ensure we don't lose status-code schemas
		const app = new Elysia().guard(
			{
				response: {
					200: t.Object({ data: t.String() }),
					404: t.Object({ error: t.String() }),
					500: t.Object({ message: t.String() })
				}
			},
			(app) =>
				app.get('/data', () => ({ data: 'test' }), {
					response: t.String() // Plain schema should be merged as 200, not replace entire map
				})
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const dataRoute = flatRoutes.find((r) => r.path === '/data')

		expect(dataRoute).toBeDefined()
		expect(dataRoute?.hooks.response).toBeDefined()

		// The plain schema should override 200 but preserve 404 and 500
		expect(dataRoute?.hooks.response[200]).toBeDefined()
		expect(dataRoute?.hooks.response[404]).toBeDefined()
		expect(dataRoute?.hooks.response[500]).toBeDefined()

		// The 200 response should be the plain schema from the route (more specific)
		expect(dataRoute?.hooks.response[200].type).toBe('string')

		// Other status codes should be preserved from guard
		expect(dataRoute?.hooks.response[404].type).toBe('object')
		expect(dataRoute?.hooks.response[500].type).toBe('object')
	})
})
