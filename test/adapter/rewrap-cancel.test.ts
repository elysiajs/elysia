import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

// Regression: createResponseHandler used response.clone().body which teed the
// stream and left the orphaned original branch open — source cancel() never
// propagated to the client consumer.
describe('rewrap cancel propagation', () => {
	it('cancelling the rewrapped response body cancels the source stream', async () => {
		let pulls = 0
		let cancelled = false

		const infinite = new ReadableStream({
			pull(controller) {
				pulls++
				controller.enqueue(new Uint8Array([pulls]))
			},
			cancel() {
				cancelled = true
			}
		})

		const app = new Elysia().get(
			'/stream',
			// Elysia 2 order: (path, hook, handler)
			{ afterHandle({ set }) { set.headers['x-test'] = 'yes' } },
			() => new Response(infinite)
		)

		const res = await app.handle(new Request('http://localhost/stream'))
		const reader = res.body!.getReader()

		// Read one chunk to let the pull start
		await reader.read()
		await reader.cancel()

		// Give the microtask queue a moment to propagate the cancel
		await new Promise((r) => setTimeout(r, 10))

		expect(cancelled).toBe(true)
	})

	it('rewrap merges headers, status, and statusText correctly', async () => {
		const app = new Elysia().get(
			'/merge',
			{ afterHandle({ set }) { set.headers['x-added'] = 'also' } },
			() =>
				new Response('body', {
					status: 201,
					statusText: 'Created',
					headers: { 'x-original': 'yes' }
				})
		)

		const res = await app.handle(new Request('http://localhost/merge'))
		expect(res.status).toBe(201)
		expect(res.statusText).toBe('Created')
		expect(res.headers.get('x-original')).toBe('yes')
		expect(res.headers.get('x-added')).toBe('also')
		expect(await res.text()).toBe('body')
	})

	it('rewrap preserves string body content', async () => {
		const app = new Elysia().get(
			'/text',
			{ afterHandle({ set }) { set.headers['x-extra'] = '1' } },
			() => new Response('hello world')
		)

		const res = await app.handle(new Request('http://localhost/text'))
		expect(await res.text()).toBe('hello world')
		expect(res.headers.get('x-extra')).toBe('1')
	})

	it('rewrap preserves stream body content', async () => {
		const chunks = ['foo', 'bar', 'baz']
		let i = 0
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (i < chunks.length)
					controller.enqueue(new TextEncoder().encode(chunks[i++]))
				else controller.close()
			}
		})

		const app = new Elysia().get(
			'/stream-body',
			{ afterHandle({ set }) { set.headers['x-piped'] = 'yes' } },
			() => new Response(stream)
		)

		const res = await app.handle(
			new Request('http://localhost/stream-body')
		)
		expect(res.headers.get('x-piped')).toBe('yes')
		expect(await res.text()).toBe('foobarbaz')
	})
})
