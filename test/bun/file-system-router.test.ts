import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { Elysia } from '../../src'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'

describe('File System Router', () => {
	let testDir: string

	beforeAll(async () => {
		// Create a temporary test directory
		testDir = join(process.cwd(), 'test-fs-router')
		try {
			await mkdir(testDir, { recursive: true })
			await mkdir(join(testDir, 'pages'), { recursive: true })
			await mkdir(join(testDir, 'pages', 'blog'), { recursive: true })
			await mkdir(join(testDir, 'pages', 'api'), { recursive: true })
			await mkdir(join(testDir, 'pages', 'api', 'users'), {
				recursive: true
			})
		} catch (error) {
			// Clean up partial creation
			await rm(testDir, { recursive: true, force: true }).catch(() => {})
			throw error
		}

		// Create test route files
		await writeFile(
			join(testDir, 'pages', 'index.ts'),
			'export default ({ params, query, request }) => ({ message: "Hello from index", params, query })'
		)

		await writeFile(
			join(testDir, 'pages', 'about.ts'),
			'export default ({ params, query, request }) => ({ message: "About page", params, query })'
		)

		await writeFile(
			join(testDir, 'pages', 'blog', 'index.ts'),
			'export default ({ params, query, request }) => ({ message: "Blog index", params, query })'
		)

		await writeFile(
			join(testDir, 'pages', 'blog', '[slug].ts'),
			'export default ({ params, query, request }) => ({ message: `Blog post: ${params.slug}`, params, query })'
		)

		await writeFile(
			join(testDir, 'pages', 'api', 'users', '[id].ts'),
			'export default ({ params, query, request }) => ({ userId: params.id, params, query })'
		)

		await writeFile(
			join(testDir, 'pages', '[[...catchall]].ts'),
			'export default ({ params, query, request }) => ({ catchall: params.catchall, params, query })'
		)

		// Create test files with method-specific handlers
		await writeFile(
			join(testDir, 'pages', 'api', 'users.ts'),
			'export default { GET: ({ params, query, request }) => ({ method: "GET", message: "Get users", params, query }), POST: ({ params, query, request }) => ({ method: "POST", message: "Create user", params, query }) }'
		)

		await writeFile(
			join(testDir, 'pages', 'api', 'users', 'profile.ts'),
			'export default { GET: ({ params, query, request }) => ({ method: "GET", message: "Get profile", params, query }), PUT: ({ params, query, request }) => ({ method: "PUT", message: "Update profile", params, query }), PATCH: ({ params, query, request }) => ({ method: "PATCH", message: "Patch profile", params, query }), DELETE: ({ params, query, request }) => ({ method: "DELETE", message: "Delete profile", params, query }) }'
		)

		await writeFile(
			join(testDir, 'pages', 'broken.ts'),
			'export default "not a function"'
		)
	})

	afterAll(async () => {
		// Clean up test directory
		await rm(testDir, { recursive: true, force: true })
	})

	it('should initialize FileSystemRouter correctly', () => {
		const app = new Elysia()

		expect(() => {
			app.fileSystemRouter({
				dir: join(testDir, 'pages'),
				style: 'nextjs',
				origin: 'http://localhost:3000',
				assetPrefix: '/_next/static/'
			})
		}).not.toThrow()

		expect(app['~fileSystemRouter']).toBeDefined()
		expect(app['~fileSystemRouterDir']).toBe(join(testDir, 'pages'))
	})

	it('should have Bun.FileSystemRouter available', () => {
		// In Bun runtime, FileSystemRouter should be available
		expect(typeof Bun).toBe('object')
		expect(Bun.FileSystemRouter).toBeDefined()
	})

	it('should match exact routes', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(new Request('http://localhost/'))
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.message).toBe('Hello from index')
		expect(data.params).toEqual({})
		expect(data.query).toEqual({})
	})

	it('should match exact routes with about page', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(new Request('http://localhost/about'))
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.message).toBe('About page')
		expect(data.params).toEqual({})
		expect(data.query).toEqual({})
	})

	it('should match nested exact routes', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(new Request('http://localhost/blog'))
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.message).toBe('Blog index')
		expect(data.params).toEqual({})
		expect(data.query).toEqual({})
	})

	it('should match dynamic routes with parameters', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/blog/my-awesome-post')
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.message).toBe('Blog post: my-awesome-post')
		expect(data.params).toEqual({ slug: 'my-awesome-post' })
		expect(data.query).toEqual({ slug: 'my-awesome-post' })
	})

	it('should match deeply nested dynamic routes', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/api/users/123')
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.userId).toBe('123')
		expect(data.params).toEqual({ id: '123' })
		expect(data.query).toEqual({ id: '123' })
	})

	it('should handle query parameters', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/blog/my-post?foo=bar&baz=qux')
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.message).toBe('Blog post: my-post')
		expect(data.params).toEqual({ slug: 'my-post' })
		expect(data.query).toEqual({ foo: 'bar', baz: 'qux', slug: 'my-post' })
	})

	it('should match catch-all routes', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/unknown/path/deep')
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		// Bun returns catchall as a string path, not an array
		expect(data.catchall).toBe('unknown/path/deep')
		expect(data.params).toEqual({ catchall: 'unknown/path/deep' })
		expect(data.query).toEqual({ catchall: 'unknown/path/deep' })
	})

	it('should match catch-all routes for unmatched paths', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/nonexistent')
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.catchall).toBe('nonexistent')
		expect(data.params).toEqual({ catchall: 'nonexistent' })
	})

	it('should handle malformed route files gracefully', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/broken')
		)

		// Malformed route should surface as 500 (invalid export)
		expect(response.status).toBe(500)
	})

	it('should work with Request objects directly', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const request = new Request(
			'http://localhost/blog/test-post?param=value'
		)
		const response = await app.handle(request)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.message).toBe('Blog post: test-post')
		expect(data.params).toEqual({ slug: 'test-post' })
		expect(data.query).toEqual({ param: 'value', slug: 'test-post' })
	})

	it('should prioritize regular Elysia routes over file system routes', async () => {
		const app = new Elysia()
			.fileSystemRouter({
				dir: join(testDir, 'pages'),
				style: 'nextjs'
			})
			.get('/about', () => ({ message: 'Regular route handler' }))

		const response = await app.handle(new Request('http://localhost/about'))
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.message).toBe('Regular route handler')
	})

	it('should handle file extensions correctly', async () => {
		// Create a route with different extension
		await writeFile(
			join(testDir, 'pages', 'test.js'),
			'export default ({ params, query, request }) => ({ message: "JS file", params, query })'
		)

		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs',
			fileExtensions: ['.ts']
		})

		const response = await app.handle(new Request('http://localhost/test'))

		// Clean up
		await rm(join(testDir, 'pages', 'test.js'), { force: true })

		// Test that .js files are ignored when fileExtensions only includes .ts
		// The catch-all route should match instead
		expect(response.status).toBe(200)
		const data = (await response.json()) as any
		expect(data.catchall).toBe('test')
	})

	it('should handle method-specific handlers - GET', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/api/users', { method: 'GET' })
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.method).toBe('GET')
		expect(data.message).toBe('Get users')
	})

	it('should handle method-specific handlers - POST', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/api/users', { method: 'POST' })
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.method).toBe('POST')
		expect(data.message).toBe('Create user')
	})

	it('should handle method-specific handlers for different routes - GET profile', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/api/users/profile', { method: 'GET' })
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.method).toBe('GET')
		expect(data.message).toBe('Get profile')
	})

	it('should handle method-specific handlers for different routes - PUT profile', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/api/users/profile', { method: 'PUT' })
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.method).toBe('PUT')
		expect(data.message).toBe('Update profile')
	})

	it('should handle method-specific handlers for different routes - PATCH profile', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/api/users/profile', {
				method: 'PATCH'
			})
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.method).toBe('PATCH')
		expect(data.message).toBe('Patch profile')
	})

	it('should handle method-specific handlers for different routes - DELETE profile', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		const response = await app.handle(
			new Request('http://localhost/api/users/profile', {
				method: 'DELETE'
			})
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.method).toBe('DELETE')
		expect(data.message).toBe('Delete profile')
	})

	it('should handle HEAD method by falling back to GET', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		// HEAD method falls back to GET when not explicitly defined
		const response = await app.handle(
			new Request('http://localhost/api/users/profile', {
				method: 'HEAD'
			})
		)
		expect(response.status).toBe(200)

		const data = (await response.json()) as any
		expect(data.method).toBe('GET')
		expect(data.message).toBe('Get profile')
	})

	it('should return 404 for unsupported methods on method-specific routes', async () => {
		const app = new Elysia().fileSystemRouter({
			dir: join(testDir, 'pages'),
			style: 'nextjs'
		})

		// OPTIONS method is not defined in the profile route and has no fallback
		const response = await app.handle(
			new Request('http://localhost/api/users/profile', {
				method: 'OPTIONS'
			})
		)
		expect(response.status).toBe(404)
	})
})
