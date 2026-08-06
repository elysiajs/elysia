import { Elysia, problem, HTTPError } from '../src'

class Error2 extends HTTPError.id('error2') {
	value() {
		return problem(418, {
			detail: "I'm a teapot"
		})
	}
}

const app = new Elysia()
	.get('/', () => {
		if (Math.random() > 0.25) return new Error2()

		return 'ok'
	})

type A = (typeof app)['~Routes']['get']['response']
