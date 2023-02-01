import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => 'A')
	.group('/counter', (app) =>
		app
			.state('counter', 0)
			.onRequest(({ store }) => {
				store.counter++
			})
			.get('/', ({ store: { counter } }) => counter)
	)
	.listen(8080)

// @ts-ignore
console.log(app.router)

fetch('http://localhost:8080/counter')
	.then((x) => x.text())
	.then(console.log)
