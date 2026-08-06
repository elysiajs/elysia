import { Elysia, problem, tag } from '../src'

class Error2 extends tag('error2') {
	body() {
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
