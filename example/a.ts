import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ query }) => query)
	.get('/a', ({ query }) => query)
	.post('/json', (c) => c.body, {
		type: 'json'
	})
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})

app.handle(new Request('http://localhost/a?a=b#a'))
	.then((x) => x.json())
	.then(console.log)
