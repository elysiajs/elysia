import { Elysia, t } from '../src/2'

class A extends Error {
	status = 500

	constructor(public message: string) {
		super(message)
	}
}

const app = new Elysia()
	.onError(A, () => 'Got A')
	.get('/query', () => {
		throw new A('Hello')
	})

app.handle('query?name=bb').then((res) =>
	res.text().then((text) => console.log(text))
)

app.handle('query?name=bb')
	.then((res) => res.status)
	.then(console.log)
