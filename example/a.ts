import { Elysia, problem } from '../src'

class Error1 extends Error {}
class Error2 extends Error {}
class Error3 extends Error {
	constructor() {
		super('a')
	}
}

type C = Error extends Error3 ? true : false

const app = new Elysia()
	.error(Error1, () => problem(400, { detail: 'q' }))
	.error(Error2, () => problem(401, { detail: 'q' }))
	.get('/', () => {
		if (Math.random() > 0.25) return new Error1()
		if (Math.random() > 0.25) return new Error2()
		// if (Math.random() > 0.25) return new Error3()

		return 'ok'
	})

app['~Routes']['get']['response']
