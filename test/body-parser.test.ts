import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'

describe('Body Parser', () => {
	it('handle onParse', async () => {
		const app = new Elysia()
			.onParse((request, contentType) => {
				switch (contentType) {
					case 'application/Elysia':
						return request.text()
				}
			})
			.post('/', ({ body }) => body)
			.listen(8080)

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: ':D',
				headers: {
					'content-type': 'application/Elysia',
					'content-length': '2'
				}
			})
		)

		expect(await res.text()).toBe(':D')
	})

	it("handle .on('parse')", async () => {
		const app = new Elysia()
			.on('parse', (request, contentType) => {
				switch (contentType) {
					case 'application/Elysia':
						return request.text()
				}
			})
			.post('/', ({ body }) => body)
			.listen(8080)

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: ':D',
				headers: {
					'content-type': 'application/Elysia',
					'content-length': '2'
				}
			})
		)

		expect(await res.text()).toBe(':D')
	})

	it('overwrite default parser', async () => {
		const app = new Elysia()
			.onParse((request, contentType) => {
				switch (contentType) {
					case 'text/plain':
						return 'Overwrited'
				}
			})
			.post('/', ({ body }) => body)
			.listen(8080)

		const res = await app.handle(
			new Request('http://localhost/', {
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
