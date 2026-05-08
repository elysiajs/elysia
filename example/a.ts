import { Elysia, t } from '../src'

const app = new Elysia()
	.model({
		a: t.Object({
			a: t.Optional(t.Ref('a'))
		})
	})
	.post(`/1`, () => 'ok', {
		body: 'a'
	})

app.handler(0, true)
app.handle('/1', {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json'
	},
	body: JSON.stringify({
		a: {
			a: {
				b: 'a',
				a: {}
			}
		}
	})
})
	.then((res) => res.text())
	.then(console.log)
