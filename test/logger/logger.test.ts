import { Elysia } from '../../src'
import { logger, type LogEntry } from '../../src/logger'

import { describe, expect, it } from 'bun:test'
import { req, post, delay } from '../utils'

describe('Logger', () => {
	it('logs GET request with method, path, status, and duration', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.get('/', () => 'Hello World')

		await app.handle(req('/'))

		await delay(10)

		expect(logs.length).toBe(1)
		expect(logs[0].method).toBe('GET')
		expect(logs[0].path).toBe('/')
		expect(logs[0].status).toBe(200)
		expect(logs[0].duration).toBeGreaterThanOrEqual(0)
		expect(logs[0].timestamp).toBeInstanceOf(Date)
	})

	it('logs POST request', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.post('/users', () => 'Created')

		await app.handle(post('/users', { name: 'John' }))

		await delay(10)

		expect(logs.length).toBe(1)
		expect(logs[0].method).toBe('POST')
		expect(logs[0].path).toBe('/users')
	})

	it('logs correct status code for errors', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.get('/error', ({ status }) => status(500, 'Internal Error'))

		await app.handle(req('/error'))

		await delay(10)

		expect(logs.length).toBe(1)
		expect(logs[0].status).toBe(500)
	})

	it('logs custom status codes', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.get('/created', ({ set }) => {
				set.status = 201
				return 'Created'
			})

		await app.handle(req('/created'))

		await delay(10)

		expect(logs[0].status).toBe(201)
	})

	it('skips paths in skip array', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry),
					skip: ['/health', '/metrics']
				})
			)
			.get('/health', () => 'OK')
			.get('/metrics', () => 'metrics')
			.get('/api', () => 'api')

		await app.handle(req('/health'))
		await app.handle(req('/metrics'))
		await app.handle(req('/api'))

		await delay(10)

		expect(logs.length).toBe(1)
		expect(logs[0].path).toBe('/api')
	})

	it('skips paths with custom function', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry),
					skip: (path) => path.startsWith('/internal')
				})
			)
			.get('/internal/health', () => 'OK')
			.get('/internal/status', () => 'status')
			.get('/api', () => 'api')

		await app.handle(req('/internal/health'))
		await app.handle(req('/internal/status'))
		await app.handle(req('/api'))

		await delay(10)

		expect(logs.length).toBe(1)
		expect(logs[0].path).toBe('/api')
	})

	it('skips paths with double wildcard pattern /**', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry),
					skip: ['/internal/**']
				})
			)
			.get('/internal', () => 'internal')
			.get('/internal/health', () => 'OK')
			.get('/internal/deep/nested/path', () => 'nested')
			.get('/api', () => 'api')

		await app.handle(req('/internal'))
		await app.handle(req('/internal/health'))
		await app.handle(req('/internal/deep/nested/path'))
		await app.handle(req('/api'))

		await delay(10)

		expect(logs.length).toBe(1)
		expect(logs[0].path).toBe('/api')
	})

	it('skips paths with single wildcard pattern /*', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry),
					skip: ['/users/*']
				})
			)
			.get('/users/123', () => 'user 123')
			.get('/users/456', () => 'user 456')
			.get('/users/123/posts', () => 'posts')
			.get('/users', () => 'users list')

		await app.handle(req('/users/123'))
		await app.handle(req('/users/456'))
		await app.handle(req('/users/123/posts'))
		await app.handle(req('/users'))

		await delay(10)

		expect(logs.length).toBe(2)
		expect(logs.map((l) => l.path)).toEqual(['/users/123/posts', '/users'])
	})

	it('logs multiple requests', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.get('/a', () => 'A')
			.get('/b', () => 'B')
			.get('/c', () => 'C')

		await app.handle(req('/a'))
		await app.handle(req('/b'))
		await app.handle(req('/c'))

		await delay(10)

		expect(logs.length).toBe(3)
		expect(logs.map((l) => l.path)).toEqual(['/a', '/b', '/c'])
	})

	it('works with plugins', async () => {
		const logs: LogEntry[] = []

		const plugin = new Elysia().get('/plugin', () => 'plugin')

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.use(plugin)
			.get('/', () => 'Hello')

		await app.handle(req('/'))
		await app.handle(req('/plugin'))

		await delay(10)

		expect(logs.length).toBe(2)
	})

	it('measures duration correctly', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.get('/slow', async () => {
				await delay(50)
				return 'Slow response'
			})

		await app.handle(req('/slow'))

		await delay(10)

		expect(logs.length).toBe(1)
		// Duration should be at least 50ms due to delay
		expect(logs[0].duration).toBeGreaterThanOrEqual(45)
	})

	it('logs 404 for not found routes', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.get('/', () => 'Hello')

		await app.handle(req('/not-found'))

		await delay(10)

		expect(logs.length).toBe(1)
		expect(logs[0].status).toBe(404)
		expect(logs[0].path).toBe('/not-found')
	})

	it('logs different HTTP methods', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.get('/resource', () => 'get')
			.post('/resource', () => 'post')
			.put('/resource', () => 'put')
			.delete('/resource', () => 'delete')
			.patch('/resource', () => 'patch')

		await app.handle(req('/resource'))
		await app.handle(
			new Request('http://localhost/resource', { method: 'POST' })
		)
		await app.handle(
			new Request('http://localhost/resource', { method: 'PUT' })
		)
		await app.handle(
			new Request('http://localhost/resource', { method: 'DELETE' })
		)
		await app.handle(
			new Request('http://localhost/resource', { method: 'PATCH' })
		)

		await delay(10)

		expect(logs.length).toBe(5)
		expect(logs.map((l) => l.method)).toEqual([
			'GET',
			'POST',
			'PUT',
			'DELETE',
			'PATCH'
		])
	})

	it('works with route parameters', async () => {
		const logs: LogEntry[] = []

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.get('/users/:id', ({ params }) => `User ${params.id}`)

		await app.handle(req('/users/123'))

		await delay(10)

		expect(logs.length).toBe(1)
		expect(logs[0].path).toBe('/users/123')
	})

	it('uses default logger when no output specified', async () => {
		// Just verify it doesn't throw
		const app = new Elysia().use(logger()).get('/', () => 'Hello')

		const response = await app.handle(req('/'))
		expect(response.status).toBe(200)
	})

	it('respects colored option', async () => {
		// Test that colored: false doesn't throw
		const app = new Elysia()
			.use(logger({ colored: false }))
			.get('/', () => 'Hello')

		const response = await app.handle(req('/'))
		expect(response.status).toBe(200)
	})

	it('logs with global scope across plugins', async () => {
		const logs: LogEntry[] = []

		const plugin = new Elysia({ name: 'plugin' }).get('/plugin', () => 'OK')

		const app = new Elysia()
			.use(
				logger({
					output: (entry) => logs.push(entry)
				})
			)
			.use(plugin)

		await app.handle(req('/plugin'))

		await delay(10)

		expect(logs.length).toBe(1)
		expect(logs[0].path).toBe('/plugin')
	})
})
