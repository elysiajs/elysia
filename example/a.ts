import { Elysia, t } from '../src'
import { req } from '../test/utils'

const c = new Elysia()
	.headers({
		'X-Powered-By': 'benchmark'
	})
	.get('/id/:id', (context) => context.params.id + ' ' + context.query.name)
	.listen(3000)

// c.handle(req('/id/1?name=bun')).then(x => x.text()).then(console.log)

console.log(c.router.history[0].composed?.toString())

// const app = new Elysia().get('/a', 'a').get('/b', 'b').use(c).listen(8080)

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
