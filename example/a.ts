import { Elysia, t } from '../src'
import { hasType } from '../src/schema'
import { req, upload } from '../test/utils'

const app = new Elysia()
	.post('/', ({ body }) => 'ok', {
		body: t.Union([
			t.Object({
				hello: t.String(),
				file: t.File({
					type: 'image'
				}),
				a: t.File({
					type: 'image'
				})
			}),
			t.Object({
				world: t.String(),
				image: t.File({
					type: 'image'
				})
			}),
			t.Object({
				world: t.String()
			})
		])
	})
	.listen(3000)

// console.log(app.routes[0].compile().toString())

// app.handle(
// 	upload('/', {
// 		hello: 'world',
// 		file: 'aris-yuzu.jpg'
// 	}).request
// )
// 	.then((x) => x.text())
// 	.then(console.log)

// // console.log(app.router)
