import { Elysia, redirect, t } from '../src'
import { mapResponse } from '../src/adapter/web-standard/handler'

const response = mapResponse(redirect('https://cunny.school', 302), {
	status: "I'm a teapot",
	headers: {
		Name: 'Sorasaki Hina'
	},
	redirect: 'https://cunny.school',
	cookie: {}
})

console.log(response.headers.toJSON())

// const a = new Elysia()
// 	.model({
// 		a: t.Object({
// 			a: t.Ref('a')
// 		}),
// 	})
// 	.model((model) => ({
// 		...model,
// 		b: t.Object({
// 			a: model.a,
// 			b: t.Ref('b')
// 		})
// 	}))
// 	.get('/', ({ body }) => 'a', {
// 		body: 'b'
// 	})
// 	.listen(3000)

// a._routes.index.get.response[422].
