import { Elysia } from '../src'

const app = new Elysia()
	.ws('/ws', { message: (ws, message) => ws.send(message) })
	.group('/nes', (app) =>
		app.use((app) =>
			app.group('/ted', (app) =>
				app.ws('/ws', { message: (ws, message) => ws.send(message) })
			)
		)
	)
	.listen(3000)

console.log(app.routes)

// const api = treaty(a)

// const { data, error, response } = await api.error.get()

// console.log(data, error, response)
