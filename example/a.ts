import { Elysia, t } from '../src'
import { Validator } from '../src/validator'

const a = performance.now()

const app = new Elysia()
	.model({
		a: t.Object({
			a: t.String()
		}),
		b: t.Object({
			b: t.String()
		})
	})
	.macro({
		a: {
			body: 'a'
		}
	})
	.post(
		'/',
		{
			a: true,
			body: 'b'
		},
		({ body }) => body
	)

app.handle('/', {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json'
	},
	body: JSON.stringify({
		a: 'a',
		b: 'test'
	})
})
	.then((x) => x.json())
	.then(console.log)

console.log(`🦊 App ready in ${(performance.now() - a).toFixed(6)}ms`)
