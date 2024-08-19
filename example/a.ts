import { Elysia } from '../src'

const app = new Elysia().post('/', ({ body }) => body)

const res = await app.handle(
	new Request('https://e.ly', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: `tea_party=nagisa&tea_party=mika&tea_party=seia`
	})
)

console.log(await res.json())
