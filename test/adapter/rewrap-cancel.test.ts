import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'

describe('response metadata mapping', () => {
	it('cancelling a response with mapped headers cancels its source stream', async () => {
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
			{
				afterHandle({ set }) {
					set.headers['x-test'] = 'yes'
				}
			},
			() => new Response(infinite)
		)

		const res = await app.handle(new Request('http://localhost/stream'))
		const reader = res.body!.getReader()

		await reader.read()
		await reader.cancel()

		// Allow cancellation to propagate to the source.
		await new Promise((r) => setTimeout(r, 10))

		expect(cancelled).toBe(true)
	})

	it('preserves original headers, status, and status text', async () => {
		const app = new Elysia().get(
			'/merge',
			{
				afterHandle({ set }) {
					set.headers['x-added'] = 'also'
				}
			},
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
		await expect(res.text()).resolves.toBe('body')
	})

	it('preserves a string body when adding headers', async () => {
		const app = new Elysia().get(
			'/text',
			{
				afterHandle({ set }) {
					set.headers['x-extra'] = '1'
				}
			},
			() => new Response('hello world')
		)

		const res = await app.handle(new Request('http://localhost/text'))
		await expect(res.text()).resolves.toBe('hello world')
		expect(res.headers.get('x-extra')).toBe('1')
	})

	it('preserves a stream body when adding headers', async () => {
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
			{
				afterHandle({ set }) {
					set.headers['x-piped'] = 'yes'
				}
			},
			() => new Response(stream)
		)

		const res = await app.handle(
			new Request('http://localhost/stream-body')
		)
		expect(res.headers.get('x-piped')).toBe('yes')
		await expect(res.text()).resolves.toBe('foobarbaz')
	})
})
