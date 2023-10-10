import { Elysia, t } from '../src'

const a = new Elysia()

const app = new Elysia()
	.derive(x => ({
		a: "A"
	}))
	.state("b", 'b')
	.ws('/', {
		message({ send, data: { a, store: { b } } }) {
			send(a)
		}
	})
	.listen(3000)

console.log(app.routes.map((x) => x.path))
// console.log(app.routes[1].composed?.toString())
