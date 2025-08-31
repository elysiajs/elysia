import { Elysia, t } from '../src'
import { z } from 'zod'
import { req } from '../test/utils'

const app = new Elysia()
	.guard({
		schema: 'standalone',
		body: z
			.object({
				age: z.number()
			})
			.loose()
	})
	.post('/', ({ body }) => ({ body }), {
		body: z.object({
			age: z.number()
		})
	})
	.listen(3000)

// const q = app
// 	.handle(req('/'))
// 	.then((x) => x.text())
// 	.then(console.log)
