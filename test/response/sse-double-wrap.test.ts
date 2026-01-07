import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

describe('SSE - Response Double Wrapping', () => {
	it('should not double-wrap SSE data when returning pre-formatted Response', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers.hello = 'world'

			return new Response('data: hello\n\ndata: world\n\n', {
				headers: {
					'content-type': 'text/event-stream',
					'transfer-encoding': 'chunked'
				},
				status: 200
			})
		})

		const response = await app.handle(new Request('http://localhost/')).then(r => r.text())

		// Should NOT double-wrap with "data: data:"
		expect(response).toBe('data: hello\n\ndata: world\n\n')
		expect(response).not.toContain('data: data:')
	})

	it('should not double-wrap SSE when using set.headers with pre-formatted content', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-custom'] = 'test'
			set.headers['content-type'] = 'text/event-stream'

			return new Response('data: message1\n\ndata: message2\n\n', {
				headers: {
					'transfer-encoding': 'chunked'
				}
			})
		})

		const response = await app.handle(new Request('http://localhost/')).then(r => r.text())

		expect(response).toBe('data: message1\n\ndata: message2\n\n')
		expect(response).not.toContain('data: data:')
	})

	it('should properly format SSE for generator functions', async () => {
		const app = new Elysia().get('/', function* () {
			yield 'hello'
			yield 'world'
		})

		const response = await app
			.handle(
				new Request('http://localhost/', {
					headers: {
						'content-type': 'text/event-stream'
					}
				})
			)
			.then((r) => r.text())

		// Generator without explicit SSE should format as plain text
		expect(response).toContain('hello')
		expect(response).toContain('world')
	})

	it('should format SSE correctly for generators with explicit SSE configuration', async () => {
		const { sse } = await import('../../src')
		
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['content-type'] = 'text/event-stream'
			
			return (async function* () {
				yield sse({ data: 'first message' })
				yield sse({ data: 'second message' })
			})()
		})

		const response = await app
			.handle(new Request('http://localhost/'))
			.then((r) => r.text())

		// Generator WITH explicit SSE markers should get properly formatted
		expect(response).toContain('data: first message\n\n')
		expect(response).toContain('data: second message\n\n')
		// Should NOT double-wrap
		expect(response).not.toContain('data: data:')
	})
})
