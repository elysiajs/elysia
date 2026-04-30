import { Elysia, t } from '../src/2'

const a = new Elysia().derive('plugin', function a() {
	console.log('a')
})

const b = new Elysia({ as: 'plugin' }).use(a).derive(function b() {
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
