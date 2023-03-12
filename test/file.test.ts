import { Elysia, t } from '../src'
import { describe, expect, it } from 'bun:test'
import { upload } from './utils'

const app = new Elysia()
	.post('/single', ({ body: { file } }) => file.size, {
		schema: {
			body: t.Object({
				file: t.File()
			})
		}
	})
	.post(
		'/multiple',
		({ body: { files } }) => files.reduce((a, b) => a + b.size, 0),
		{
			schema: {
				body: t.Object({
					files: t.Files()
				})
			}
		}
	)
	.listen(8080)

describe('File', () => {
	it('accept single image', async () => {
    const {request,size} = upload('/single', {
      file: 'millenium.jpg'
    })
		const res = await app.handle(request)    

		expect(await res.text()).toEqual(size.toString())
	})

	it('accept multiple image', async () => {
    const {request,size} = upload('/multiple', {
      files: ['aris-yuzu.jpg', 'aris-yuzu.jpg']
    })
		const res = await app.handle(request)

		expect(await res.text()).toEqual(size.toString())
	})
})
