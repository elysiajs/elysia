import { Elysia, t } from '../src/2'

const app = new Elysia()
	.beforeHandle(() => {
		console.log('B')
	})
	.afterHandle(() => {
		console.log('Q')
	})
	.get('/', () => 'hi')

console.log(app.handler(0, true).toString())

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
