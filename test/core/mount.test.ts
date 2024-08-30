import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('Mount', () => {
	it('preserve request URL', async () => {
		const plugin = new Elysia().get('/', ({ request }) => request.url)

		const app = new Elysia().mount('/mount', plugin.handle)

		expect(
			await app
				.handle(new Request('http://elysiajs.com/mount/'))
				.then((x) => x.text())
		).toBe('http://elysiajs.com/')
	})

	it('preserve request URL with query', async () => {
		const plugin = new Elysia().get('/', ({ request }) => request.url)

		const app = new Elysia().mount('/mount', plugin.handle)

		expect(
			await app
				.handle(new Request('http://elysiajs.com/mount/?a=1'))
				.then((x) => x.text())
		).toBe('http://elysiajs.com/?a=1')
	})

	it('preserve body', async () => {
		const handler = async (req: Request) => {
			return new Response(await req.text())
		}

		const app = new Elysia()
			.mount('/mount', (req) => handler(req))
			.post('/not-mount', ({ body }) => body)

		const options = {
			method: 'POST',
			headers: {
				'content-type': 'text/plain'
			},
			body: 'sucrose'
		}

		const res = await Promise.all([
			app
				.handle(new Request('http://elysiajs.com/mount', options))
				.then((x) => x.text()),
			app
				.handle(new Request('http://elysiajs.com/not-mount', options))
				.then((x) => x.text())
		])

		expect(res).toEqual(['sucrose', 'sucrose'])
	})
})
