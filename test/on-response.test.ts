// import { Elysia } from '../src'

// import { describe, expect, it } from 'bun:test'
// import { req } from './utils'

// describe('On Response', () => {
// 	it('Inherits set if Response is return', async () => {
// 		const app = new Elysia()
// 			.onResponse(({ set }) => {
// 				expect(set.status).toBe(401)
// 			})
// 			.onError(() => {
// 				return new Response('a', {
// 					status: 401,
// 					headers: {
// 						awd: 'b'
// 					}
// 				})
// 			})

// 		await app.handle(req('/'))
// 	})
// })
