import { Elysia, problem, tag } from '../src'

class Error1 extends tag('error1') {}
class Error2 extends tag('error2') {
	body() {
		return problem(418, {
			detail: 'a'
		})
	}
}

const app = new Elysia()
	.error(Error1, problem(400, { detail: 'q' }))
	.error(Error2, problem(401, { detail: 'q' }))
	.get('/', () => {
		if (Math.random() > 0.25) return new Error1()
		if (Math.random() > 0.25) return new Error2()
		if (Math.random() > 0.25) return new Error()

		return 'ok'
	})
	.listen(3000)

app.handle('/')
	.then((x) => x.text())
	.then(console.log)

type A = (typeof app)['~Routes']['get']['response']
