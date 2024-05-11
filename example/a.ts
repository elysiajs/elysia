import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.get('/hello', ({ cookie: { name } }) => {
		name.value = 'SaltyAom'
		name.partitioned = false

		return `Hello, ${name}!`
	})
	.listen(3000)

// console.log(app.routes[0].composed.toString())

app.handle(req('/hello?name=hello+123'))
	.then((x) => x.text())
	.then((x) => console.log({ x }))
