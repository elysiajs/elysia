import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../../src'
import { EdgeOneAdapter, createEdgeOneHandler, type EdgeOneContext } from '../../../src/adapter/edgeone'

describe('EdgeOne adapter', () => {
	it('should handle basic request', async () => {
		const app = new Elysia({ adapter: EdgeOneAdapter })
			.get('/', () => 'Hello from EdgeOne!')
			.compile()

		const context: EdgeOneContext = {
			request: new Request('http://localhost/'),
			params: {},
			env: {}
		}

		const handler = createEdgeOneHandler(app)
		const response = await handler(context)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('Hello from EdgeOne!')
	})

	it('should handle request with params', async () => {
		const app = new Elysia({ adapter: EdgeOneAdapter })
			.get('/users/:id', ({ params }) => `User ${params.id}`)
			.compile()

		const context: EdgeOneContext = {
			request: new Request('http://localhost/users/123'),
			params: { id: '123' },
			env: {}
		}

		const handler = createEdgeOneHandler(app)
		const response = await handler(context)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('User 123')
	})

	it('should expose EdgeOne context properties', async () => {
		const app = new Elysia({ adapter: EdgeOneAdapter })
			.get('/', (context: any) => {
				// EdgeOne specific properties are available at runtime
				return {
					params: context.params,
					env: context.env,
					clientIp: context.clientIp,
					edgeoneServer: context.edgeoneServer,
					geo: context.geo,
					uuid: context.uuid
				}
			})
			.compile()

		const context: EdgeOneContext = {
			request: new Request('http://localhost/'),
			params: { test: 'value' },
			env: { NODE_ENV: 'test' },
			clientIp: '192.168.1.1',
			server: {
				region: 'us-east-1',
				requestId: 'req-123'
			},
			geo: {
				country: 'US',
				city: 'New York'
			},
			uuid: 'test-uuid-123'
		}

		const handler = createEdgeOneHandler(app)
		const response = await handler(context)
		const data = (await response.json()) as {
			params: Record<string, string>
			env: Record<string, unknown>
			clientIp: string
			edgeoneServer: { region: string; requestId: string }
			geo: Record<string, unknown>
			uuid: string
		}

		expect(data.params).toEqual({ test: 'value' })
		expect(data.env).toEqual({ NODE_ENV: 'test' })
		expect(data.clientIp).toBe('192.168.1.1')
		expect(data.edgeoneServer).toEqual({
			region: 'us-east-1',
			requestId: 'req-123'
		})
		expect(data.geo).toEqual({
			country: 'US',
			city: 'New York'
		})
		expect(data.uuid).toBe('test-uuid-123')
	})

	it('should handle POST request with body', async () => {
		const app = new Elysia({ adapter: EdgeOneAdapter })
			.post('/users', ({ body }) => {
				return { created: body }
			})
			.compile()

		const context: EdgeOneContext = {
			request: new Request('http://localhost/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'John', age: 30 })
			}),
			params: {},
			env: {}
		}

		const handler = createEdgeOneHandler(app)
		const response = await handler(context)
		const data = (await response.json()) as {
			created: { name: string; age: number }
		}

		expect(response.status).toBe(200)
		expect(data.created).toEqual({ name: 'John', age: 30 })
	})

	it('should handle 404 not found', async () => {
		const app = new Elysia({ adapter: EdgeOneAdapter })
			.get('/exists', () => 'Found')
			.compile()

		const context: EdgeOneContext = {
			request: new Request('http://localhost/not-found'),
			params: {},
			env: {}
		}

		const handler = createEdgeOneHandler(app)
		const response = await handler(context)

		expect(response.status).toBe(404)
	})

	it('should handle query parameters', async () => {
		const app = new Elysia({ adapter: EdgeOneAdapter })
			.get('/search', ({ query }) => {
				return { q: query.q, page: query.page }
			})
			.compile()

		const context: EdgeOneContext = {
			request: new Request('http://localhost/search?q=test&page=1'),
			params: {},
			env: {}
		}

		const handler = createEdgeOneHandler(app)
		const response = await handler(context)
		const data = (await response.json()) as {
			q: string
			page: string
		}

		expect(response.status).toBe(200)
		expect(data.q).toBe('test')
		expect(data.page).toBe('1')
	})

	it('should throw error if app is not compiled', () => {
		const app = new Elysia({ adapter: EdgeOneAdapter })
			.get('/', () => 'Hello')

		// Create a new app instance without compiling
		const uncompiledApp = {
			...app,
			_handle: undefined,
			fetch: undefined
		} as any

		expect(() => {
			createEdgeOneHandler(uncompiledApp)
		}).toThrow('Elysia instance must be compiled')
	})

	it('should handle different HTTP methods', async () => {
		const app = new Elysia({ adapter: EdgeOneAdapter })
			.get('/resource', () => 'GET')
			.post('/resource', () => 'POST')
			.put('/resource', () => 'PUT')
			.delete('/resource', () => 'DELETE')
			.patch('/resource', () => 'PATCH')
			.compile()

		const baseContext: Omit<EdgeOneContext, 'request'> = {
			params: {},
			env: {}
		}

		const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const
		const handler = createEdgeOneHandler(app)

		for (const method of methods) {
			const context: EdgeOneContext = {
				...baseContext,
				request: new Request('http://localhost/resource', {
					method
				})
			}

			const response = await handler(context)
			expect(response.status).toBe(200)
			expect(await response.text()).toBe(method)
		}
	})
})
