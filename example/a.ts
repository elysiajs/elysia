import { Elysia, ParseError } from '../src'

const app = new Elysia()
	.onError(({ code, error }) => {
		if (code === 'PARSE') {
			console.log(error.status, 'uwu') // 400
			return 'UwU'
		}
	})
	.onParse(() => {
		throw new ParseError()
	})
	.post('/', ({ body }) => body)

const response = await app.handle(
	new Request('http://localhost/', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({})
	})
)

console.log(await response.text()) // UwU
console.log(response.status) // 500