import { Elysia, t } from '../src'

const app = new Elysia().all('/', () => 'a')

app.handle('/', {
	method: 'POST',
	headers: {
		'content-type': 'application/json'
	},
	body: JSON.stringify({
		a: 'a'
	})
})
	.then((r) => r.text())
	.then(console.log)
