import { Elysia } from '../src'

const app = new Elysia()
	.wrap((fn) => {
		return (request) => {
			console.log("Q")

			return fn(request)
		}
	})
	.get('/', () => 'ok')

type Response = (typeof app)['~Routes']['get']['response']

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
