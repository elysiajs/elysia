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
})
