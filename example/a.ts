import { Elysia, HTTPError, status } from '../src'

class CustomError<T extends string> extends HTTPError.id('CUSTOM_ERROR') {
	constructor(public message: T) {
		super(message)
	}

	value() {
		return status(418, `quack! ${this.message}`)
	}
}

const app = new Elysia()
	.get('/', () => Math.random() > 0.5 ? new CustomError('q') : 'ok')
	.listen(3000)




type a = (typeof app['~Routes'])['get']['response']
