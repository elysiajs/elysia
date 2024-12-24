import { Elysia, file, getSchemaValidator, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.get('/image', async () => {
		return file('test/kyuukurarin.mp4')
	})
	.listen(3000)

// console.log(app.routes[0].compile().toString())

// app.handle(req('/'))

// console.log(
// 	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
// )
