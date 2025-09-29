import { describe, expect, it, spyOn, beforeEach, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { CloudflareAdapter } from '../../src/adapter/cloudflare-worker'

describe('Cloudflare Worker Adapter Lifecycle Hooks', () => {
	let consoleSpy: ReturnType<typeof spyOn>

	beforeEach(() => {
		consoleSpy = spyOn(console, 'log')
	})

	afterEach(() => {
		consoleSpy.mockRestore()
	})

	describe('Server-level hooks', () => {
		it('should call onStart lifecycle hooks when app is compiled', () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onStart(() => {
					console.log('🚀 Server started!')
				})
				.get('/', () => 'Hello World')
				.compile()

			expect(consoleSpy).toHaveBeenCalledWith('🚀 Server started!')
		})

		it('should call multiple onStart hooks in order', () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onStart(() => {
					console.log('First onStart')
				})
				.onStart(() => {
					console.log('Second onStart')
				})
				.get('/', () => 'Hello World')
				.compile()

			expect(consoleSpy).toHaveBeenCalledWith('First onStart')
			expect(consoleSpy).toHaveBeenCalledWith('Second onStart')
		})

		it('should not call onStart hooks if none are registered', () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.get('/', () => 'Hello World')
				.compile()

			expect(consoleSpy).not.toHaveBeenCalled()
		})

		it('should call onStop hooks when stop is called', async () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onStop(() => {
					console.log('🛑 Server stopped!')
				})
				.get('/', () => 'Hello World')
				.compile()
			
			// Call stop to trigger onStop hooks
			await app.stop()

			expect(consoleSpy).toHaveBeenCalledWith('🛑 Server stopped!')
		})
	})

	describe('Request-level hooks', () => {
		it('should call onRequest hooks during request processing', async () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onRequest(() => {
					console.log('📨 Request received!')
				})
				.get('/', () => 'Hello World')
				.compile()

			const response = await app.fetch(new Request('http://localhost/'))
			expect(response.status).toBe(200)
			expect(consoleSpy).toHaveBeenCalledWith('📨 Request received!')
		})

		it('should call onParse hooks during request parsing', async () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onParse(() => {
					console.log('🔍 Parsing request!')
				})
				.post('/', () => 'Hello World')
				.compile()

			const response = await app.fetch(new Request('http://localhost/', {
				method: 'POST',
				body: JSON.stringify({ test: 'data' }),
				headers: { 'Content-Type': 'application/json' }
			}))
			expect(response.status).toBe(200)
			expect(consoleSpy).toHaveBeenCalledWith('🔍 Parsing request!')
		})

		it('should call onTransform hooks during context transformation', async () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onTransform(() => {
					console.log('🔄 Transforming context!')
				})
				.get('/', () => 'Hello World')
				.compile()

			const response = await app.fetch(new Request('http://localhost/'))
			expect(response.status).toBe(200)
			expect(consoleSpy).toHaveBeenCalledWith('🔄 Transforming context!')
		})

		it('should call onBeforeHandle hooks before route handler', async () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onBeforeHandle(() => {
					console.log('⚡ Before handle!')
				})
				.get('/', () => 'Hello World')
				.compile()

			const response = await app.fetch(new Request('http://localhost/'))
			expect(response.status).toBe(200)
			expect(consoleSpy).toHaveBeenCalledWith('⚡ Before handle!')
		})

		it('should call onAfterHandle hooks after route handler', async () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onAfterHandle(() => {
					console.log('✅ After handle!')
				})
				.get('/', () => 'Hello World')
				.compile()

			const response = await app.fetch(new Request('http://localhost/'))
			expect(response.status).toBe(200)
			expect(consoleSpy).toHaveBeenCalledWith('✅ After handle!')
		})

		it('should call onAfterResponse hooks after response is sent', async () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onAfterResponse(() => {
					console.log('📤 After response!')
				})
				.get('/', () => 'Hello World')
				.compile()

			const response = await app.fetch(new Request('http://localhost/'))
			expect(response.status).toBe(200)
			expect(consoleSpy).toHaveBeenCalledWith('📤 After response!')
		})

		it('should call onError hooks when an error occurs', async () => {
			const app = new Elysia({
				adapter: CloudflareAdapter
			})
				.onError(() => {
					console.log('❌ Error occurred!')
					return 'Error handled'
				})
				.get('/', () => {
					throw new Error('Test error')
				})
				.compile()

			const response = await app.fetch(new Request('http://localhost/'))
			expect(response.status).toBe(500)
			expect(consoleSpy).toHaveBeenCalledWith('❌ Error occurred!')
		})
	})
})
