import { Elysia, t } from '../src'

class CustomError extends Error {
	constructor() {
		super()
	}
}

const app = new Elysia()
	.error('CUSTOM_ERROR', CustomError)
	.get('/', ({ body }) => {
		throw new CustomError()
	})
	.listen(3000)

console.log(app.routes[0].composed?.toString())
