import { Elysia } from '../src'

class Data {
	message: String

	constructor(message: String) {
		this.message = message
	}

	toString() {
		return JSON.stringify(this)
	}
}

const app = new Elysia({ precompile: true })
	.get('/', () => {
		return new Data('pong')
	})
	.get('/ping', ({ set }) => {
		const data = new Data('pong')

		set.status = 200

		return data
	})
	.listen(3000)

console.log(app.routes[1].composed.toString())
