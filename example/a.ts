import { Elysia, t } from '../src'

const app = new Elysia()
	.onAfterHandle((context) => {
		context.response = 'A'
	})
	.get('/', () => 'NOOP')
	.listen(3000)

console.log(
	`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
)
