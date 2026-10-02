import { Elysia, HTTPError, status } from '../src'

class CustomError<T extends string> extends HTTPError.id('CUSTOM_ERROR') {
	constructor(public message: T) {
		super(message)
	}

	value() {
		return status(418, `quack! ${this.message}`)
	}
}

const app = new Elysia().get('/', () =>
	Math.random() > 0.5 ? new CustomError('q') : 'ok'
)

app.handle('/')
	.then((res) => res.status)
	.then(console.log)

type a = (typeof app)['~Routes']['get']['response']
