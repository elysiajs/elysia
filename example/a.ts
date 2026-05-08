import { Elysia, t } from '../src'

const routes = new Elysia().beforeHandle('global', () => {
	console.log(1)
}).get('/0', () => {})

const app = new Elysia()
	// .beforeHandle(() => {
	// 	console.log(2)
	// })
	// .use(routes)
	.get('/1', () => 'ok')
	.get('/2', () => 'ok')
	// .beforeHandle(() => {
	// 	console.log(2)
	// })
	// .use(routes)
	.get('/3', () => 'ok')
	.get('/4', () => 'ok')

console.log(app)

app.handler(0, true)
app.handle('/1')
	.then((res) => res.text())
	.then(console.log)
