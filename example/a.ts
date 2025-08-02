import { Elysia, t } from '../src'

const app = new Elysia({ aot: false })
	.headers({
		'X-Powered-By': 'Elysia'
	})
	.get('/', () => 'Hello')
	.listen(3000)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
