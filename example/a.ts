import { Elysia, file, getSchemaValidator, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.onAfterHandle(() => {
		console.log('after handle')
	})
	.mapResponse((context) => {
		return context.response
	})
	.get('/', async () => {
		return 'ok'
	})
	.listen(3000)

console.log(app.routes[0].compile().toString())

// app.handle(req('/'))

// console.log(
// 	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
// )
