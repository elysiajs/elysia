import { Elysia } from '../src/2'
import { NotFound } from '../src/2/error'

const plugin = new Elysia().get('/k', () => 'ok')

const app = new Elysia()
	.use(plugin)
	.get('/query', ({ query }) => query)
	.listen(3000)

// app.handle('query?name=bb').then((res) =>
// 	res.text().then((text) => console.log(text))
// )

// app.handle('query?name=bb')
// 	.then((res) => res.status)
// 	.then(console.log)
