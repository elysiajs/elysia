import { KingWorld } from '../src'

import { describe, expect, it } from 'bun:test'

describe('Body Parser', () => {
	it('handle onParse', async () => {
		const app = new KingWorld()
			.onParse((request, contentType) => {
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
			.on('parse', (request, contentType) => {
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

	it('overwrite default parser', async () => {
		const app = new KingWorld()
			.onParse((request, contentType) => {
				switch (contentType) {
					case 'text/plain':
						return 'Overwrited'
				}
			})
			.post('/', ({ body }) => body)
			.listen(3000)

		const res = await app.handle(
			new Request('/', {
				method: 'POST',
				body: ':D',
				headers: {
					'content-type': 'text/plain',
					'content-length': '2'
				}
			})
		)

		expect(await res.text()).toBe('Overwrited')
	})
})
