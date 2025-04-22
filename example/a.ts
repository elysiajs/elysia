import { Elysia, form, t } from '../src'
import { mapResponse } from '../src/adapter/bun/handler'

const plugin = new Elysia()
	.get('/', ({ body }) => {
		body.images
	}, {
		body: t.Object({
			images: t.Files({
				maxSize: '4m',
				type: 'image'
			})
		})
	})
	.listen(3000)

// const app = new Elysia().use(plugin).listen(3000)

// console.log('Server started on http://localhost:3000')
