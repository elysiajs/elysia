import KingWorld from '../src'

import { describe, expect, it } from 'bun:test'

describe('Body Parser', () => {
	it('handle onParse', async () => {
		const app = new KingWorld()
			.onParse(async (request) => {
				const contentType = request.headers.get('content-type') ?? ''

				switch (contentType) {
					case 'application/kingworld':
						return request.text()
				}
			})
			.post('/', ({ body }) => body)
			.listen(3000)

		const res = await app.handle(
			new Request('/', {
				method: 'POST',
				body: ':D',
				headers: {
					'content-type': 'application/kingworld',
					'content-length': '2'
				}
			})
		)

		expect(await res.text()).toBe(':D')
	})

	it("handle .on('parse')", async () => {
		const app = new KingWorld()
			.on('parse', async (request) => {
				const contentType = request.headers.get('content-type') ?? ''

				switch (contentType) {
					case 'application/kingworld':
						return request.text()
				}
			})
			.post('/', ({ body }) => body)
			.listen(3000)

		const res = await app.handle(
			new Request('/', {
				method: 'POST',
				body: ':D',
				headers: {
					'content-type': 'application/kingworld',
					'content-length': '2'
				}
			})
		)

		expect(await res.text()).toBe(':D')
	})
})
