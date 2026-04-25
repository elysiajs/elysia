import { Elysia } from '../src/2'
import { NotFound } from '../src/2/error'

class A extends Error {
	status = 418

	constructor(public message: string) {
		super(message)
	}
}

const app = new Elysia()
	.onError(A, 'Got A')
	.onError(NotFound, ({ error, code }) => {
		return ':('
	})
	.get('/query', () => {
		throw new A('Hello')
	})
	.listen(3000)

app.handle('query?name=bb').then((res) =>
	res.text().then((text) => console.log(text))
)

app.handle('query?name=bb')
	.then((res) => res.status)
	.then(console.log)
