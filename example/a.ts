import { Elysia } from '../src'

const app = new Elysia()
	.onError(({ error }) => {
		console.error(error)
	})
	.ws('/', {
		error: ({ error }) => {
			console.error(error)
		},
		message(ws) {
			throw new Error('test')
		}
	})
	.listen(4000)

// console.log(app.fetch.toString())

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
