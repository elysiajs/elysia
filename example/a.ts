import { Elysia, t } from '../src'

const app = new Elysia().post('/', () => 'a', {
	body: t.Object({
		a: t.String()
	})
})

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
