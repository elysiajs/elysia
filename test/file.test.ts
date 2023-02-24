// import { Elysia, t } from '../src'

// import { describe, expect, it } from 'bun:test'
// import { upload } from './utils'

// const app = new Elysia()
// 	.post('/single', ({ body: { file } }) => file.size, {
// 		schema: {
// 			body: t.Object({
// 				file: t.File()
// 			})
// 		}
// 	})
// 	.post(
// 		'/multiple',
// 		({ body: { files } }) => files.reduce((a, b) => a + b.size, 0),
// 		{
// 			schema: {
// 				body: t.Object({
// 					files: t.Files()
// 				})
// 			}
// 		}
// 	)
// 	.listen(8080)

// describe('File', () => {
// 	it('accept single image', async () => {
// 		const response = await app.handle(
// 			upload('/single', {
// 				file: 'millenium.jpg'
// 			})
// 		)

// 		expect(response).toEqual(1)
// 	})

// 	it('accept multiple image', async () => {
// 		const response = await app.handle(
// 			upload('/multiple', {
// 				file: ['aris-yuzu.jpg', 'aris-yuzu.jpg']
// 			})
// 		)

// 		expect(response).toEqual(true)
// 	})
// })
