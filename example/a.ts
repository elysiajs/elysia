import { Elysia, t } from '../src'
import { upload } from '../test/utils'

const app = new Elysia()
	.post('/single', ({ body: { file } }) => file, {
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

app.handle(
	upload('/single', {
		file: 'millenium.jpg'
	})
).then(r => r.text()).then(console.log)
