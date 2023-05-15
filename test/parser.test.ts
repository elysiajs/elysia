import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'

describe('Parser', () => {
	it('handle onParse', async () => {
		const app = new Elysia()
			.onParse((context, contentType) => {
				switch (contentType) {
					case 'application/Elysia':
						return 'A'
				}
			})
			.post('/', ({ body }) => body)

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

		expect(await res.text()).toBe('A')
	})

	it("handle .on('parse')", async () => {
		const app = new Elysia()
			.on('parse', (context, contentType) => {
				switch (contentType) {
					case 'application/Elysia':
						return context.request.text()
				}
			})
			.post('/', ({ body }) => body)

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
			.onParse((context, contentType) => {
				switch (contentType) {
					case 'text/plain':
						return 'Overwrited'
				}
			})
			.post('/', ({ body }) => body)

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

	it('parse x-www-form-urlencoded', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const body = {
			username: 'salty aom',
			password: '12345678'
		}

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: `username=${body.username}&password=${body.password}`,
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				}
			})
		)

		expect(await res.json()).toEqual(body)
	})

	it('parse with extra content-type attribute', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const body = {
			username: 'salty aom',
			password: '12345678'
		}

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: JSON.stringify(body),
				headers: {
					'content-type': 'application/json;charset=utf-8'
				}
			})
		)

		expect(await res.json()).toEqual(body)
	})

	it('inline parse', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			parse({ request }) {
				return request.text().then(() => 'hi')
			}
		})

		const res = await app
			.handle(
				new Request('http://localhost/', {
					method: 'POST',
					body: 'ok',
					headers: {
						'Content-Type': 'application/json'
					}
				})
			)
			.then((x) => x.text())

		expect(res).toBe('hi')
	})
})
