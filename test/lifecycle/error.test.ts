/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

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

	// it('handle parse error', async () => {
	// 	const app = new Elysia()
	// 		.onError(({ code }) => {
	// 			if (code === 'PARSE') return 'Why you no proper type'
	// 		})
	// 		.post('/', ({ body }) => 'hello')

	// 	const root = await app
	// 		.handle(
	// 			new Request('http://localhost/', {
	// 				method: 'POST',
	// 				body: 'A',
	// 				headers: {
	// 					'content-type': 'application/json'
	// 				}
	// 			})
	// 		)
	// 		.then((x) => x.text())

	// 	expect(root).toBe('Why you no proper type')
	// })

	it('custom validation error', async () => {
		const app = new Elysia()
			.onError(({ code, error, set }) => {
				if (code === 'VALIDATION') {
					set.status = 400

					return error.all.map((i) => ({
						filed: i.path.slice(1) || 'root',
						reason: i.message
					}))
				}
			})
			.post('/login', ({ body }) => body, {
				body: t.Object({
					username: t.String(),
					password: t.String()
				})
			})

		const res = await app.handle(post('/login', {}))
		const data = await res.json<any[]>()

		expect(data.length).toBe(4)
		expect(res.status).toBe(400)
	})
})
