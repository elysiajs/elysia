import { Elysia, t, ValidationError } from '../src'
import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('error', () => {
	it('use custom 404', async () => {
		const app = new Elysia()
			.get('/', () => 'hello')
			.onError(({ code, set }) => {
				if (code === 'NOT_FOUND') {
					set.status = 404

					return 'UwU'
				}
			})

		const root = await app.handle(req('/')).then((x) => x.text())
		const notFound = await app
			.handle(req('/not/found'))
			.then((x) => x.text())

		expect(root).toBe('hello')
		expect(notFound).toBe('UwU')
	})

	it('custom validation error', async () => {
		const app = new Elysia()
			.post('/login', ({ body }) => body, {
				schema: {
					body: t.Object({
						username: t.String(),
						password: t.String()
					})
				}
			})
			.onError(({ error, set }) => {
				if (error instanceof ValidationError) {
					set.status = 400
					return error.all().map((i) => ({
						filed: i.path.slice(1) || 'root',
						reason: i.message
					}))
				}
			})
		const res = await app.handle(
			new Request('http://localhost/login', {
				method: 'post',
				body: JSON.stringify({}),
				headers: {
					'content-type': 'application/json'
				}
			})
		)
		const data: any[] = await res.json()

		expect(data.length).toBe(4)
		expect(res.status).toBe(400)
	})
})
