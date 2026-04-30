import { Elysia, t } from '../src/2'

const a = new Elysia().derive('global', function a() {
	console.log('a')
})

const b = new Elysia().use(a).derive('global', function b() {
	console.log('b')
})

const app = new Elysia().use(b).get('/', () => {
	return 'xd'
})

await app
	.handle('/')
	.then((x) => x.text())
	.then(console.log)

// console.log(app.routes)

// app.listen(3000)

// app.handle('query?name=bb')
// 	.then((res) => res.status)
// 	.then(console.log)
