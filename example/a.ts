import { Elysia } from '../src'

class MyError extends Error {
	constructor(public message: string) {
		super(message)
	}
}

const errorBoundary = new Elysia({ name: 'boundary', as: 'global' })
	.error(
		MyError,
		({ status, error }) => status(418, "QQ")
	)

const app = new Elysia()
	.get('/', () => new MyError('A'))
	.use(errorBoundary)

type Response = (typeof app)['~Routes']['get']['response']

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
