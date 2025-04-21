import { Elysia, t } from '../src'
import { Memoirist } from 'memoirist'

const app = new Elysia().post('/', ({ body }) => {
	return body
})

const body = {
	username: 'salty aom',
	password: '12345678'
}

const res = await app.handle(
	new Request('http://localhost/', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: {
			'content-type': 'application/json;charset=utf-8'
		}
	})
)

console.log(app.routes[0].compile().toString())
