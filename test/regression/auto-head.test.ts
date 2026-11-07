import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { autoHead } from '../../src/plugin/auto-head'

describe('auto-HEAD response bodies', () => {
	it('cancels an unknown-length stream without synthesizing content-length', async () => {
		let pulled = 0
		const makeStream = () =>
			new ReadableStream({
				pull(controller) {
					pulled++
					if (pulled > 1)
						controller.error(
							new Error(
								'auto-HEAD must not drain the response body'
							)
						)
					else controller.enqueue(new Uint8Array([1, 2, 3]))
				}
			})

		const app = new Elysia().use(autoHead()).get(
			'/stream',
			() =>
				new Response(makeStream(), {
					headers: { 'content-type': 'application/octet-stream' }
				})
		)
		await app.modules

		await app.handle('/stream')
		const response = await app.handle('/stream', { method: 'HEAD' })

		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('')
		expect(response.headers.get('content-length')).toBeNull()
	})

	it('preserves a known content-length without reading the body', async () => {
		const app = new Elysia().use(autoHead()).get(
			'/known',
			() =>
				new Response('hello world', {
					headers: { 'content-length': '11' }
				})
		)
		await app.modules

		await app.handle('/known')
		const response = await app.handle('/known', { method: 'HEAD' })

		expect(response.status).toBe(200)
		expect(response.headers.get('content-length')).toBe('11')
		await expect(response.text()).resolves.toBe('')
	})
})
