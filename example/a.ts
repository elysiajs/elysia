import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.onError(({ error, code }) => {
		if (code === 'VALIDATION') return error.detail(error.message)
	})
	.post('/', () => 'Hello World!', {
		body: t.Object({
			x: t.Number({
				error: 'x must be a number'
			})
		})
	})

const response = await app
	.handle(
		new Request('http://localhost', {
			method: 'POST',
			body: JSON.stringify({ x: 'hi!' }),
			headers: {
				'Content-Type': 'application/json'
			}
		})
	)
	.then((x) => x.text())

console.log(response)
