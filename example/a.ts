import { Elysia, file, getSchemaValidator, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.onError(() => {})
	.mapResponse(() => {
		if (Math.random() > 2) return new Response('error', { status: 500 })
	})
	.get('/', async () => {
		return 'ok'
	})
	.listen(3000)

// console.log(app.routes[0].compile().toString())

app.handle(req('/')).then(x => x.text()).then(console.log)

// console.log(
// 	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
// )
