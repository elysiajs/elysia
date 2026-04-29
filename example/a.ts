import { Elysia, t } from '../src/2'

const a = new Elysia().derive({ as: 'scoped' }, () => ({
	a: 'a'
}))

const app = new Elysia().use(a).get('/', ({ a }) => a)

await app
	.handle('/')
	.then((x) => x.text())

// console.log(app.routes)

// app.listen(3000)

// app.handle('query?name=bb')
// 	.then((res) => res.status)
// 	.then(console.log)
