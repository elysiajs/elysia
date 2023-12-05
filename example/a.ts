import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', Bun.file('example/kyuukurarin.mp4'))
	// .get('/', ({ query }) => query, {
	// 	query: t.Object({
	// 		id: t.Numeric({
	// 			default: 0
	// 		})
	// 	})
	// })
	.listen(3000)

// app.handle(new Request('http://localhost'))

console.log(app.fetch.toString())
console.log(app.routes[0].composed?.toString())
