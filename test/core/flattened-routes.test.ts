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

	it('preserves string schema aliases during merging', () => {
		// Define models that will be referenced by string aliases
		const app = new Elysia()
			.model({
				UserPayload: t.Object({
					name: t.String(),
					email: t.String()
				}),
				UserResponse: t.Object({
					id: t.String(),
					name: t.String()
				}),
				ErrorResponse: t.Object({
					error: t.String(),
					message: t.String()
				})
			})
			.guard(
				{
					headers: t.Object({
						authorization: t.String()
					}),
					response: {
						401: 'ErrorResponse',
						500: 'ErrorResponse'
					}
				},
				(app) =>
					app.post('/users', ({ body }) => body, {
						body: 'UserPayload',
						response: 'UserResponse'
					})
			)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const usersRoute = flatRoutes.find((r) => r.path === '/users')

		expect(usersRoute).toBeDefined()

		// Body should be a TRef to UserPayload
		expect(usersRoute?.hooks.body).toBeDefined()
		expect(usersRoute?.hooks.body.$ref).toBe('UserPayload')

		// Headers should be merged from guard
		expect(usersRoute?.hooks.headers).toBeDefined()
		expect(usersRoute?.hooks.headers.type).toBe('object')
		expect(usersRoute?.hooks.headers.properties).toHaveProperty(
			'authorization'
		)

		// Response should preserve both route-level (200) and guard-level (401, 500) schemas
		expect(usersRoute?.hooks.response).toBeDefined()
		expect(usersRoute?.hooks.response[200]).toBeDefined()
		expect(usersRoute?.hooks.response[401]).toBeDefined()
		expect(usersRoute?.hooks.response[500]).toBeDefined()

		// The 200 response should be the TRef from the route
		expect(usersRoute?.hooks.response[200].$ref).toBe('UserResponse')

		// The error responses should be TRefs from the guard
		expect(usersRoute?.hooks.response[401].$ref).toBe('ErrorResponse')
		expect(usersRoute?.hooks.response[500].$ref).toBe('ErrorResponse')
	})

	it('correctly handles union response schemas from guards', () => {
		// Regression test: unions don't have 'type' property, only 'anyOf'
		// Previous implementation would misclassify them as status code objects
		const app = new Elysia().guard(
			{
				response: t.Union([t.String(), t.Number()])
			},
			(app) =>
				app.get('/data', () => 'test', {
					response: t.Object({
						value: t.String()
					})
				})
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const dataRoute = flatRoutes.find((r) => r.path === '/data')

		expect(dataRoute).toBeDefined()
		expect(dataRoute?.hooks.response).toBeDefined()

		// The route-level object schema should be preserved (takes precedence)
		expect(dataRoute?.hooks.response.type).toBe('object')
		expect(dataRoute?.hooks.response.properties).toHaveProperty('value')

		// Should NOT have anyOf from the union polluting the response
		expect(dataRoute?.hooks.response.anyOf).toBeUndefined()

		// Should NOT have a synthetic status code structure
		expect(dataRoute?.hooks.response[200]).toBeUndefined()
	})

	it('correctly handles intersect response schemas from guards', () => {
		// Intersects use 'allOf' instead of 'type'
		const app = new Elysia().guard(
			{
				response: {
					200: t.Intersect([
						t.Object({ id: t.String() }),
						t.Object({ timestamp: t.Number() })
					]),
					404: t.Object({ error: t.String() })
				}
			},
			(app) =>
				app.get('/item', () => ({ id: '1', timestamp: 123 }), {
					response: t.Object({
						id: t.String(),
						timestamp: t.Number(),
						extra: t.String()
					})
				})
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const itemRoute = flatRoutes.find((r) => r.path === '/item')

		expect(itemRoute).toBeDefined()
		expect(itemRoute?.hooks.response).toBeDefined()

		// The 200 response should be the route-level object (takes precedence)
		expect(itemRoute?.hooks.response[200]).toBeDefined()
		expect(itemRoute?.hooks.response[200].type).toBe('object')
		expect(itemRoute?.hooks.response[200].properties).toHaveProperty('extra')

		// The 404 from guard should be preserved
		expect(itemRoute?.hooks.response[404]).toBeDefined()
		expect(itemRoute?.hooks.response[404].type).toBe('object')
		expect(itemRoute?.hooks.response[404].properties).toHaveProperty('error')

		// Should NOT have allOf polluting the status code object
		expect(itemRoute?.hooks.response.allOf).toBeUndefined()
	})

	it('correctly handles t.Any and other schemas without type property', () => {
		// Test other schemas that don't have 'type' property
		const app = new Elysia().guard(
			{
				response: {
					200: t.Any(),
					500: t.Object({ error: t.String() })
				}
			},
			(app) =>
				app.get('/any', () => 'anything', {
					response: t.String()
				})
		)

		// @ts-expect-error - accessing protected method for testing
		const flatRoutes = app.getFlattenedRoutes()

		const anyRoute = flatRoutes.find((r) => r.path === '/any')

		expect(anyRoute).toBeDefined()
		expect(anyRoute?.hooks.response).toBeDefined()

		// The 200 response should be the route-level string schema
		expect(anyRoute?.hooks.response[200]).toBeDefined()
		expect(anyRoute?.hooks.response[200].type).toBe('string')

		// The 500 from guard should be preserved
		expect(anyRoute?.hooks.response[500]).toBeDefined()
		expect(anyRoute?.hooks.response[500].type).toBe('object')
	})
})
