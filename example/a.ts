import { Elysia, t } from '../src'
import { Validator } from '../src/validator'

const a = performance.now()

const app = new Elysia()
	.route('Elysia', '/', 'ok')

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
