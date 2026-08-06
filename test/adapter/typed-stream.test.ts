import { describe, expect, it } from 'bun:test'
import { bytes, Elysia } from '../../src'

const request = () => new Request('http://localhost/')

const streamOf = (payload = new Uint8Array([0, 1, 2, 253, 254, 255])) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(payload)
			controller.close()
		}
	})

describe('certified byte streams', () => {
	it('passes the exact stream body through with only the byte content type', async () => {
		const source = streamOf()
		const response = await new Elysia()
			.get('/', () => bytes(source))
			.handle(request())

		expect(response.body).toBe(source)
		expect(response.headers.get('content-type')).toBe(
			'application/octet-stream'
		)
		expect(response.headers.get('transfer-encoding')).toBeNull()
		expect(response.headers.get('cache-control')).toBeNull()
		expect(response.headers.get('connection')).toBeNull()
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(
			new Uint8Array([0, 1, 2, 253, 254, 255])
		)
	})

	it('preserves explicit response metadata and cookies', async () => {
		const source = streamOf()
		const response = await new Elysia()
			.get('/', ({ cookie, set }) => {
				set.status = 202
				set.headers['content-type'] = 'application/vnd.example.bytes'
				set.headers['x-byte-stream'] = 'yes'
				cookie.session.value = 'ok'

				return bytes(source)
			})
			.handle(request())

		expect(response.body).toBe(source)
		expect(response.status).toBe(202)
		expect(response.headers.get('content-type')).toBe(
			'application/vnd.example.bytes'
		)
		expect(response.headers.get('x-byte-stream')).toBe('yes')
		expect(response.headers.getSetCookie()).toEqual(['session=ok; Path=/'])
	})

	it('delegates cancellation to the source exactly once', async () => {
		let cancellations = 0
		const source = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array([1]))
			},
			cancel() {
				cancellations++
			}
		})
		const response = await new Elysia()
			.get('/', () => bytes(source))
			.handle(request())
		const reader = response.body!.getReader()

		await reader.read()
		await reader.cancel()
		await reader.cancel()

		expect(cancellations).toBe(1)
	})

	it('fails through the error pipeline for locked or consumed sources', async () => {
		const locked = streamOf()
		const reader = locked.getReader()
		const lockedResponse = await new Elysia()
			.get('/', () => bytes(locked))
			.handle(request())
		reader.releaseLock()

		const consumed = streamOf()
		await new Response(consumed).arrayBuffer()
		const consumedResponse = await new Elysia()
			.get('/', () => bytes(consumed))
			.handle(request())

		expect(lockedResponse.status).toBe(500)
		expect(consumedResponse.status).toBe(500)
	})

	it('keeps unmarked streams on the compatibility mapper', async () => {
		const source = streamOf(new TextEncoder().encode('ok'))
		const response = await new Elysia()
			.get('/', () => source)
			.handle(request())

		expect(response.body).not.toBe(source)
		expect(response.headers.get('content-type')).toBe('text/plain')
		expect(response.headers.get('transfer-encoding')).toBe('chunked')
		expect(response.headers.get('cache-control')).toBe('no-cache')
		await expect(response.text()).resolves.toBe('ok')
	})
})
