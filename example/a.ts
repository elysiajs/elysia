import { Elysia, t } from '../src'

const app = new Elysia()
	.all('/', () => 'Hi')
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})

console.log(app.staticRouter)