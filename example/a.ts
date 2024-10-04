import { Elysia } from '../src'

const app = new Elysia()
	.post('/', (context) => {
		context.b
	}, {
		derive: () => { return { b: 'b' } }
		// resolve: () => ({ resolved: 'a' })
	})
	.listen(3000)

app.handle(new Request('http://localhost/'))
	.then((t) => t.text())
	.then(console.log)
