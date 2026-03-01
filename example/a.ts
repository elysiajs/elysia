import { Elysia, t, getSchemaValidator, fileType } from '../src'
import { z } from 'zod'
import { post } from '../test/utils'

const bunFilePath6 = `test/images/aris-yuzu.jpg`
const bunFile = Bun.file(bunFilePath6) as File

const app = new Elysia().post('/upload', ({ body }) => body, {
	body: z.object({
		name: z.string(),
		file: z.file().refine((file) => fileType(file, 'image/jpeg')),
		metadata: z.object({
			age: z.coerce.number()
		})
	})
})

const formData = new FormData()
formData.append('name', 'John')
formData.append('file', bunFile)
formData.append('metadata', JSON.stringify({ age: '25' }))

const response = await app.handle(
	new Request('http://localhost/upload', {
		method: 'POST',
		body: formData
	})
)

const result = await response.json()
console.log(result)
// expect(response.status).toBe(200)
// expect(result).toMatchObject({
// 	name: 'John',
// 	metadata: { age: 25 }
// })
