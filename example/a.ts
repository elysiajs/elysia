import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.onError(({ error }) => {
		console.log(error)
	})
	.ws('/ws', {
		message(ws, message) {
			ws.send(message)
		}
	})
	.listen(8080)

// console.log(app.router.static.http)

// console.log(scoped.router.history.map((x) => x.path))
// console.log(app.router.history.map((x) => x.path))
// console.log(app.fetch.toString())

// console.log(await app.handle(req('/')).then((x) => x.text()), 1)
// await app.handle(req('/aaa')).then(x => x.text()).then(console.log)
// await app.handle(req('/scoped')).then(x => x.text()).then(console.log)
// console.log(await app.handle(req('/scoped')).then((x) => x.json()), {
// 	outer: 1,
// 	inner: 1
// })
// console.log(await app.handle(req('/')).then((x) => x.text()), 2)

// const a = await app.handle(req('/')).then((x) => x.json())

// console.log(a)
