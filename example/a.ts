import { Elysia, t, validateFileExtension } from '../src'
import { z } from 'zod'

const app = new Elysia()
	.post('', ({ body: { file } }) => file, {
		body: z.object({
			file: z
				.file()
				.refine((file) => validateFileExtension(file, 'image/jpeg'))
		})
	})
	.listen(3000)

console.log(app.routes[0].compile().toString())
