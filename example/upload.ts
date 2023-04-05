import { Elysia, t } from '../src'
import { upload } from '../test/utils'

const app = new Elysia()
	.post('/single', ({ body: { text } }) => text, {
		schema: {
			body: t.Object({
				file: t.File(),
				text: t.String()
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

const { request } = upload('/single', {
	file: 'millenium.jpg'
})

app.handle(request).then(r => r.text()).then(console.log)
